import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig } from '../config';
import { AuthedUser, FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { ArcChain } from '../arc/chain';
import { CircleWallets, StoredWallet } from '../circle/wallets';
import { MARKET, type AssetView } from '../market/market.types';
import { ActionsStore, type ActionRow } from '../trade/actions';
import { UsersService, type UserRow } from '../users/users.service';
import {
  handleFrom,
  photoFor,
  USERNAME_RE,
  usernameBase,
  usernameCandidates,
  UsersController,
  within,
} from './users.controller';
import {
  ArcDepositsController,
  DEPOSITS,
  DepositsPort,
  externalTransfers,
  FAILED_SENTENCES,
  parseTransferCursor,
  primaryHash,
  toWalletTransaction,
  WalletsController,
} from './wallets.controller';

const config = loadConfig({ ARC_NETWORK: 'mainnet' } as NodeJS.ProcessEnv);
const USDC = '0x3600000000000000000000000000000000000000';
const EURC = config.network.eurc.address.toLowerCase();
const MEME = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const ODD = '0x1111111111111111111111111111111111111111';

/** The users table in memory: exact-byte unique names like the real index, lower() lookups like the service. */
class FakeUsers {
  rows = new Map<string, UserRow>();
  async ensure(u: AuthedUser): Promise<UserRow> {
    const r = this.rows.get(u.uid);
    if (!r) {
      this.rows.set(u.uid, {
        uid: u.uid,
        email: u.email,
        username: null,
        displayName: u.name,
        avatarUrl: u.picture,
        bio: null,
        coverPhotoUrl: null,
        notificationsEnabled: null,
        publicWins: null,
        createdAt: new Date('2026-09-28T10:00:00Z').toISOString(),
      });
    } else {
      r.email = u.email ?? r.email;
      r.displayName ??= u.name;
      r.avatarUrl ??= u.picture;
    }
    return { ...this.rows.get(u.uid)! };
  }
  async get(uid: string) {
    const r = this.rows.get(uid);
    return r ? { ...r } : null;
  }
  async byUsername(name: string) {
    for (const r of this.rows.values()) if (r.username?.toLowerCase() === name.toLowerCase()) return { ...r };
    return null;
  }
  async setUsername(uid: string, name: string) {
    for (const r of this.rows.values()) if (r.username === name && r.uid !== uid) return false;
    this.rows.get(uid)!.username = name;
    return true;
  }
  async setProfile(uid: string, p: { displayName?: string | null; avatarUrl?: string | null }) {
    const r = this.rows.get(uid)!;
    if (p.displayName != null) r.displayName = p.displayName;
    if (p.avatarUrl != null) r.avatarUrl = p.avatarUrl;
  }
}

const people: Record<string, AuthedUser> = {
  lev: { uid: 'uid_lev_000001', email: 'lev@example.com', name: 'Levent Ağar', picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c' },
  lev2: { uid: 'uid_lev_000002', email: 'Lev+poppin@example.com', name: null, picture: null },
  anon: { uid: 'uid_anon_00003', email: null, name: null, picture: null },
  pic: { uid: 'uid_pic_000004', email: 'pic@example.com', name: null, picture: 'https://example.com/me.png' },
};

function action(p: Partial<ActionRow> & Pick<ActionRow, 'id' | 'kind' | 'status'>): ActionRow {
  return {
    uid: people.lev.uid,
    tokenIn: null,
    tokenOut: null,
    amountInRaw: null,
    amountOutRaw: null,
    usdValue: null,
    sourceUrl: null,
    legs: [],
    error: null,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:05.000Z',
    ...p,
  };
}

interface Booted {
  app: INestApplication;
  base: string;
  users: FakeUsers;
  wallets: {
    configured: boolean;
    find: jest.Mock;
    ensureArcWallet: jest.Mock;
  };
  chain: { balancesOf: jest.Mock; client: { multicall: jest.Mock } };
  actions: { listForUser: jest.Mock; tokensForUser?: jest.Mock };
  market: { describe: jest.Mock; pinned: jest.Mock };
}

async function boot(opts: { deposits?: DepositsPort; tokensForUser?: jest.Mock } = {}): Promise<Booted> {
  const users = new FakeUsers();
  const stored = new Map<string, StoredWallet>();
  const wallets = {
    configured: true,
    find: jest.fn(async (uid: string) => stored.get(uid) ?? null),
    ensureArcWallet: jest.fn(async (uid: string): Promise<StoredWallet> => {
      if (!users.rows.has(uid)) throw new Error('foreign key: users row missing');
      const w: StoredWallet = {
        uid,
        blockchain: 'ARC',
        walletId: `w-${uid}`,
        // Circle answers checksummed; the wire must not.
        address: '0xAbCdEf0000000000000000000000000000000001',
        accountType: 'EOA',
      };
      stored.set(uid, w);
      return w;
    }),
  };
  const chain = { balancesOf: jest.fn(), client: { multicall: jest.fn() } };
  const actions: Booted['actions'] = {
    listForUser: jest.fn(async () => [] as ActionRow[]),
    ...(opts.tokensForUser ? { tokensForUser: opts.tokensForUser } : {}),
  };
  const market = { describe: jest.fn(async () => null), pinned: jest.fn(() => []) };

  const builder = Test.createTestingModule({
    controllers: [UsersController, WalletsController, ArcDepositsController],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: UsersService, useValue: users },
      { provide: CircleWallets, useValue: wallets },
      { provide: ArcChain, useValue: chain },
      { provide: ActionsStore, useValue: actions },
      { provide: MARKET, useValue: market },
      ...(opts.deposits ? [{ provide: DEPOSITS, useValue: opts.deposits }] : []),
      FirebaseAuthGuard,
    ],
  })
    // The real guard verifies Firebase tokens over the network. Here the
    // bearer token is simply a key into `people`.
    .overrideGuard(FirebaseAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const h: string | undefined = req.headers?.authorization;
        const who = h?.startsWith('Bearer ') ? people[h.slice(7)] : undefined;
        if (!who) throw new UnauthorizedException('Sign in to continue');
        req.user = who;
        return true;
      },
    });
  const mod = await builder.compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${addr.port}/api/v1`, users, wallets, chain, actions, market };
}

type Meta = { decimals?: number; symbol?: string; name?: string };

/**
 * Arc as the controller reads it: one multicall per question. A balance of
 * 'fail' is a call the RPC answered with a failure, which is what viem does
 * to every call when the whole batch is refused.
 */
function chainReads(b: Booted, balances: Record<string, bigint | 'fail'>, meta: Record<string, Meta> = {}) {
  b.chain.client.multicall.mockImplementation(
    async ({ contracts }: { contracts: Array<{ address: string; functionName: string }> }) =>
      contracts.map((c) => {
        const v =
          c.functionName === 'balanceOf' ? (balances[c.address] ?? 0n) : meta[c.address]?.[c.functionName as keyof Meta];
        return v === undefined || v === 'fail' ? { status: 'failure', error: new Error('rpc') } : { status: 'success', result: v };
      }),
  );
}

/** Which tokens the last balance read asked about. */
function balanceReads(b: Booted): string[][] {
  return b.chain.client.multicall.mock.calls
    .map(([arg]) => arg.contracts as Array<{ address: string; functionName: string }>)
    .filter((cs) => cs[0]?.functionName === 'balanceOf')
    .map((cs) => cs.map((c) => c.address));
}

const tick = () => new Promise((r) => setTimeout(r, 20));

async function call(b: Booted, method: string, path: string, as?: string, body?: unknown) {
  const res = await fetch(`${b.base}${path}`, {
    method,
    headers: {
      ...(as ? { authorization: `Bearer ${as}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('username and photo helpers', () => {
  it('transliterates before stripping, and keeps to the client rule', () => {
    expect(handleFrom('Uğur Yılmaz')).toBe('ugur_yilmaz');
    expect(handleFrom('john.smith-1987')).toBe('john_smith_1987');
    expect(handleFrom('ab')).toBeNull();
    expect(handleFrom('a_very_long_name_indeed_yes')).toBe('a_very_long_nam');
    expect(usernameBase({ email: 'lev+tag@x.com', name: 'Someone Else' })).toBe('lev');
    expect(usernameBase({ email: 'ab@x.com', name: 'Çağla Öz' })).toBe('cagla_oz');
    expect(usernameBase({ email: null, name: null })).toBe('poppin');
  });

  it('offers names that all pass the client regex, deterministic per uid', () => {
    const c = usernameCandidates('a_very_long_nam', 'uid-1');
    expect(c[0]).toBe('a_very_long_nam');
    expect(c[1]).toBe('a_very_long_na2');
    for (const n of c) expect(n).toMatch(USERNAME_RE);
    expect(usernameCandidates('a_very_long_nam', 'uid-1')).toEqual(c);
    // The fallback base is never handed out bare.
    const p = usernameCandidates('poppin', 'uid-1');
    expect(p).not.toContain('poppin');
    expect(p.every((n) => /^poppin_\d{4}$/.test(n))).toBe(true);
  });

  it("swaps Google's letter tile for the ghost, keeps a real photo", () => {
    expect(photoFor('u1', 'https://lh3.googleusercontent.com/a/default-user=s96-c')).toMatch(
      /^https:\/\/api\.poppin\.so\/api\/v1\/avatar\/ghost-[0-5]\.png$/,
    );
    expect(photoFor('u1', null)).toBe(photoFor('u1', ''));
    expect(photoFor('u1', 'https://example.com/me.png')).toBe('https://example.com/me.png');
  });

  it('within answers null once the time is up, the value before', async () => {
    await expect(within(new Promise(() => {}), 10)).resolves.toBeNull();
    await expect(within(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe('toWalletTransaction', () => {
  const dec = (m: string) => (m === USDC ? 6 : null);
  it('drops actions that never reached the chain, maps the rest', () => {
    expect(toWalletTransaction(action({ id: 'a', kind: 'buy', status: 'failed' }), null, USDC, dec)).toBeNull();
    const failedOnChain = toWalletTransaction(
      action({ id: 'b', kind: 'sell', status: 'failed', legs: [{ kind: 'swap', status: 'failed', chain: 'arc', txHash: '0xAA' }] }),
      null,
      USDC,
      dec,
    );
    expect(failedOnChain).toMatchObject({ status: 'failed', signature: '0xaa', error_message: FAILED_SENTENCES.swap });
  });

  it('never passes the stored error through', () => {
    const legs = [{ kind: 'approve' as const, status: 'confirmed' as const, chain: 'ARC', txHash: '0x01' }];
    const failed = toWalletTransaction(
      action({ id: 'f', kind: 'buy', status: 'failed', legs, error: 'KyberSwap 4008: execution reverted at 0xdeadbeef' }),
      null,
      USDC,
      dec,
    );
    expect(failed?.error_message).toBe('This trade did not go through.');
    const pending = toWalletTransaction(
      action({ id: 'p', kind: 'deposit', status: 'sent', legs: [{ kind: 'mint', status: 'sent', chain: 'Arc', txHash: '0x02' }], error: 'after_burn: timeout' }),
      null,
      USDC,
      dec,
    );
    expect(pending?.error_message).toBeNull();
  });
});

describe('primaryHash', () => {
  it('links only to hashes on Arc', () => {
    // A deposit from Base with only its burn so far: nothing to open on Arc's explorer yet.
    expect(primaryHash([{ kind: 'burn', status: 'confirmed', chain: 'Base', txHash: '0xB0' }])).toBeNull();
    expect(
      primaryHash([
        { kind: 'burn', status: 'confirmed', chain: 'Ethereum', txHash: '0xB0' },
        { kind: 'mint', status: 'confirmed', chain: 'Arc_Testnet', txHash: '0xC0' },
      ]),
    ).toBe('0xc0');
    expect(
      primaryHash([
        { kind: 'approve', status: 'confirmed', chain: 'ARC-TESTNET', txHash: '0x01' },
        { kind: 'swap', status: 'confirmed', chain: 'ARC', txHash: '0x02' },
      ]),
    ).toBe('0x02');
    expect(primaryHash([{ kind: 'approve', status: 'confirmed', chain: 'ARC', txHash: '0x01' }])).toBe('0x01');
  });
});

describe('externalTransfers', () => {
  const arrived = (id: string, updatedAt: string, raw: string, hash: string) =>
    action({
      id,
      kind: 'deposit',
      status: 'confirmed',
      tokenIn: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      tokenOut: USDC,
      amountInRaw: raw,
      amountOutRaw: raw,
      updatedAt,
      legs: [
        { kind: 'burn', status: 'confirmed', chain: 'Base', txHash: '0xb' + id },
        { kind: 'mint', status: 'confirmed', chain: 'Arc', txHash: hash, confirmedAt: updatedAt },
      ],
    });
  const d1 = arrived('d1', '2026-09-28T10:01:00.000Z', '25000000', '0xAA01');
  const d2 = arrived('d2', '2026-09-28T10:05:00.000Z', '1500000', '0xaa02');
  const rows = [
    d2,
    action({ id: 'buy', kind: 'buy', status: 'confirmed', updatedAt: '2026-09-28T10:06:00.000Z', legs: [{ kind: 'swap', status: 'confirmed', chain: 'ARC', txHash: '0xcc' }] }),
    action({ id: 'waiting', kind: 'deposit', status: 'sent', updatedAt: '2026-09-28T10:07:00.000Z' }),
    d1,
  ];

  it('with no cursor: every arrival, oldest first, cursor at the newest', () => {
    const r = externalTransfers(rows, undefined, USDC);
    expect(r.ok).toBe(true);
    expect(r.cursor).toBe('2026-09-28T10:05:00.000Z|d2');
    expect(r.transfers).toEqual([
      { signature: '0xaa01', direction: 'in', mint: USDC, amountUi: 25, at: '2026-09-28T10:01:00.000Z' },
      { signature: '0xaa02', direction: 'in', mint: USDC, amountUi: 1.5, at: '2026-09-28T10:05:00.000Z' },
    ]);
  });

  it('with a cursor: only what came after; the cursor holds when nothing did', () => {
    const r = externalTransfers(rows, '2026-09-28T10:01:00.000Z|d1', USDC);
    expect(r.transfers.map((t) => t.signature)).toEqual(['0xaa02']);
    expect(r.cursor).toBe('2026-09-28T10:05:00.000Z|d2');
    const none = externalTransfers(rows, r.cursor, USDC);
    expect(none).toEqual({ ok: true, cursor: '2026-09-28T10:05:00.000Z|d2', transfers: [] });
  });

  it('an empty history has no cursor, so the client seeds to genesis and hears the first deposit', () => {
    expect(externalTransfers([], undefined, USDC)).toEqual({ ok: true, cursor: null, transfers: [] });
    expect(externalTransfers([d1], undefined, USDC).transfers).toHaveLength(1);
  });

  it('reads a cursor it did not write as no cursor', () => {
    for (const bad of ['5VfYdLqDzx3cS9mQ', '2026-09-28|d1', 'x'.repeat(300), '|d1']) {
      expect(parseTransferCursor(bad)).toBeNull();
      expect(externalTransfers(rows, bad, USDC).transfers).toHaveLength(2);
    }
    expect(parseTransferCursor('2026-09-28T10:01:00.000Z|d1')).toEqual({ at: '2026-09-28T10:01:00.000Z', id: 'd1' });
  });
});

describe('compat user and wallet routes', () => {
  let b: Booted;
  afterEach(async () => {
    await b?.app.close();
  });

  describe('GET /users/me', () => {
    it('creates, names and returns the reader on the first call, the wallet starting behind it', async () => {
      b = await boot();
      const r = await call(b, 'GET', '/users/me', 'lev');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        id: people.lev.uid,
        username: 'lev',
        // The Google name is not stored as the display name.
        display_name: null,
        wallet_mode: 'custodial',
        external_address: null,
        wallet_address: null,
        role: 'user',
        ditto: 0,
        created_at: '2026-09-28T10:00:00.000Z',
      });
      expect(r.body.profile_photo_url).toMatch(/\/avatar\/ghost-[0-5]\.png$/);
      expect(r.body).not.toHaveProperty('email');
      expect(r.body).not.toHaveProperty('access_token');
      expect(r.body.success).not.toBe(false);
      expect(b.wallets.ensureArcWallet).toHaveBeenCalledWith(people.lev.uid);
      await tick();
      const again = await call(b, 'GET', '/users/me', 'lev');
      expect(again.body.wallet_address).toBe('0xabcdef0000000000000000000000000000000001');
      // A wallet on file is not asked for again.
      expect(b.wallets.ensureArcWallet).toHaveBeenCalledTimes(1);
    });

    it('answers at once while Circle hangs', async () => {
      b = await boot();
      b.wallets.ensureArcWallet.mockImplementation(() => new Promise(() => {}));
      const started = Date.now();
      const r = await call(b, 'GET', '/users/me', 'lev');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ username: 'lev', wallet_address: null });
      expect(Date.now() - started).toBeLessThan(1000);
      // A second ask does not start a second creation while the first is out.
      await call(b, 'GET', '/users/me', 'lev');
      expect(b.wallets.ensureArcWallet).toHaveBeenCalledTimes(1);
    });

    it('never fails on the wallet: Circle down still answers 200 with a name', async () => {
      b = await boot();
      b.wallets.ensureArcWallet.mockRejectedValue(new Error('circle 503'));
      const r = await call(b, 'GET', '/users/me', 'pic');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ username: 'pic', wallet_address: null, profile_photo_url: 'https://example.com/me.png' });
    });

    it('does not call Circle when it is not configured', async () => {
      b = await boot();
      b.wallets.configured = false;
      const r = await call(b, 'GET', '/users/me', 'lev');
      expect(r.status).toBe(200);
      expect(r.body.wallet_address).toBeNull();
      expect(b.wallets.ensureArcWallet).not.toHaveBeenCalled();
    });

    it('steps past a taken name, whatever its case', async () => {
      b = await boot();
      await b.users.ensure({ uid: 'someone_else', email: null, name: null, picture: null });
      await b.users.setUsername('someone_else', 'Lev');
      const r = await call(b, 'GET', '/users/me', 'lev2');
      expect(r.body.username).toBe('lev2');
      const anon = await call(b, 'GET', '/users/me', 'anon');
      expect(anon.body.username).toMatch(/^poppin_\d{4}$/);
    });

    it('shares one first-sign-in between concurrent callers', async () => {
      b = await boot();
      const real = b.wallets.ensureArcWallet.getMockImplementation()!;
      b.wallets.ensureArcWallet.mockImplementation(
        (uid: string) => new Promise((res) => setTimeout(() => res(real(uid)), 150)),
      );
      const all = await Promise.all([1, 2, 3].map(() => call(b, 'GET', '/users/me', 'lev')));
      expect(new Set(all.map((r) => r.body.username))).toEqual(new Set(['lev']));
      expect(b.wallets.ensureArcWallet).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 200));
    });

    it('answers 401 in Nest shape without a token', async () => {
      b = await boot();
      const r = await call(b, 'GET', '/users/me');
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ statusCode: 401, message: 'Sign in to continue' });
    });
  });

  describe('PATCH /users/me and register', () => {
    it('refuses a name someone else holds, accepts the reader resending their own', async () => {
      b = await boot();
      await call(b, 'GET', '/users/me', 'lev');
      await call(b, 'GET', '/users/me', 'pic');
      const taken = await call(b, 'PATCH', '/users/me', 'pic', { username: 'LEV' });
      expect(taken.status).toBe(400);
      expect(taken.body).toMatchObject({ statusCode: 400, message: 'Username already exists' });
      const same = await call(b, 'PATCH', '/users/me', 'lev', { username: 'lev', profile_photo_url: null });
      expect(same.status).toBe(200);
      expect(same.body.profile_photo_url).toMatch(/ghost/);
      const renamed = await call(b, 'PATCH', '/users/me', 'lev', { username: 'Lev_A', display_name: 'Levent', bio: 'hi' });
      expect(renamed.body).toMatchObject({ username: 'Lev_A', display_name: 'Levent' });
    });

    it('explains a bad field in a sentence', async () => {
      b = await boot();
      const cases: Array<[unknown, string]> = [
        [{ username: 'ab' }, 'Username must be at least 3 characters'],
        [{ username: 'abcdefghijklmnop' }, 'Username must be at most 15 characters'],
        [{ username: 'le v' }, 'Only letters, numbers, and underscores are allowed'],
        [{ profile_photo_url: 'javascript:alert(1)' }, 'Profile photo must be a web address'],
        [{ notifications_enabled: 'yes' }, 'Notifications must be true or false'],
      ];
      for (const [body, message] of cases) {
        const r = await call(b, 'PATCH', '/users/me', 'lev', body);
        expect(r.status).toBe(400);
        expect(r.body).toEqual({ statusCode: 400, message, error: 'Bad Request' });
      }
    });

    it('register creates the row if missing and updates when a name exists', async () => {
      b = await boot();
      const first = await call(b, 'POST', '/users/me/register', 'pic', { username: 'picasso', display_name: 'picasso' });
      expect(first.status).toBe(201);
      expect(first.body.username).toBe('picasso');
      const again = await call(b, 'POST', '/users/me/register', 'pic', { username: 'pablo', display_name: 'Pablo' });
      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({ username: 'pablo', display_name: 'Pablo' });
    });
  });

  describe('public profile lookups', () => {
    it('finds by username without a token, 404 in Nest shape otherwise', async () => {
      b = await boot();
      await call(b, 'GET', '/users/me', 'lev');
      await tick();
      const finds = b.wallets.find.mock.calls.length;
      const r = await call(b, 'GET', '/users/username/LEV');
      expect(r.status).toBe(200);
      // The wallet exists by now, and still is not handed to strangers.
      expect(r.body).toMatchObject({ id: people.lev.uid, username: 'lev', wallet_address: null });
      expect(r.body).not.toHaveProperty('wallet_mode');
      const missing = await call(b, 'GET', '/users/username/nobody_here');
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ statusCode: 404, message: 'User not found' });
      const byId = await call(b, 'GET', `/users/id/${people.lev.uid}`);
      expect(byId.body).toMatchObject({ id: people.lev.uid, follower_count: 0, is_following: false, wallet_address: null });
      // Public lookups never touch the wallet table.
      expect(b.wallets.find.mock.calls.length).toBe(finds);
    });
  });

  describe('/wallets', () => {
    it('me creates the row and the wallet, lowercase public_key', async () => {
      b = await boot();
      const r = await call(b, 'GET', '/wallets/me', 'pic');
      expect(r.body).toMatchObject({
        exists: true,
        wallet: { public_key: '0xabcdef0000000000000000000000000000000001', user_id: people.pic.uid },
      });
      // The wallet needs the user row (foreign key); the route made it first.
      expect(b.users.rows.has(people.pic.uid)).toBe(true);
    });

    it('me says exists:false when Circle cannot serve, provision answers 503 with a sentence', async () => {
      b = await boot();
      b.wallets.ensureArcWallet.mockRejectedValue(new Error('circle down'));
      const r = await call(b, 'GET', '/wallets/me', 'lev');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ exists: false, message: 'Your wallet is being set up. Try again in a moment.' });
      const p = await call(b, 'POST', '/wallets/provision', 'lev');
      expect(p.status).toBe(503);
      expect(p.body.message).toBe('Your wallet is being set up. Try again in a moment.');
    });

    it('guards every wallet route', async () => {
      b = await boot();
      for (const path of [
        '/wallets/me',
        '/wallets/balance',
        '/wallets/tokens',
        '/wallets/transactions',
        '/wallets/external-transfers',
        '/arc/deposit-addresses',
      ]) {
        expect((await call(b, 'GET', path)).status).toBe(401);
      }
    });

    it('balance is null and needs no chain read', async () => {
      b = await boot();
      await call(b, 'GET', '/wallets/me', 'lev');
      const r = await call(b, 'GET', '/wallets/balance', 'lev');
      expect(r.body).toEqual({ publicKey: '0xabcdef0000000000000000000000000000000001', balance: null });
      expect(b.chain.balancesOf).not.toHaveBeenCalled();
      expect(b.chain.client.multicall).not.toHaveBeenCalled();
    });

    it('tokens: one USDC row first with usdValue, held tokens only, lowercase mints, short cache', async () => {
      b = await boot();
      await call(b, 'GET', '/wallets/me', 'lev');
      b.actions.listForUser.mockResolvedValue([
        action({ id: '1', kind: 'buy', status: 'confirmed', tokenIn: USDC, tokenOut: MEME.toUpperCase().replace('0X', '0x') }),
        action({ id: '2', kind: 'buy', status: 'confirmed', tokenIn: USDC, tokenOut: ODD }),
        action({ id: '3', kind: 'deposit', status: 'confirmed', tokenIn: 'So11111111111111111111111111111111111111112', tokenOut: USDC }),
      ]);
      chainReads(b, { [USDC]: 12_345_678n, [MEME]: 5n * 10n ** 18n, [ODD]: 250n }, { [ODD]: { decimals: 2, symbol: 'ODD', name: 'Odd Token' } });
      const memeView: AssetView = {
        token: { address: MEME, symbol: 'MEME', name: 'Meme', decimals: 18, kind: 'long-tail', icon: 'https://x/meme.png', restrictions: [] },
        priceUsd: 0.5,
        change24hPct: 12.5,
        mcapUsd: 1_000_000,
        holderCount: 321,
        liquidityUsd: 50_000,
        poolCreatedAtMs: null,
        spark24h: null,
      };
      b.market.describe.mockImplementation(async (a: string) => (a === MEME ? memeView : null));

      const r = await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(r.status).toBe(200);
      const { publicKey, tokens } = r.body;
      expect(publicKey).toBe('0xabcdef0000000000000000000000000000000001');
      expect(tokens.map((t: any) => t.mint)).toEqual([USDC, MEME, ODD]);
      expect(tokens.filter((t: any) => t.symbol === 'USDC')).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ mint: USDC, decimals: 6, amount: '12345678', uiAmount: 12.345678, usdValue: 12.345678, price: 1, isVerified: true });
      expect(tokens[1]).toMatchObject({ symbol: 'MEME', decimals: 18, uiAmount: 5, usdValue: 2.5, priceChange24h: 12.5, logoURI: 'https://x/meme.png', isVerified: false });
      expect(tokens[2]).toMatchObject({ symbol: 'ODD', name: 'Odd Token', decimals: 2, uiAmount: 2.5, usdValue: null });
      // EURC held nothing: no row. The Solana deposit source never reached the balance read.
      expect(tokens.find((t: any) => t.mint === EURC)).toBeUndefined();
      // A deposit's input is USDC on another network: never read on Arc.
      expect(balanceReads(b)[0]).not.toContain('So11111111111111111111111111111111111111112');

      // Screens asking together share one read; a refetch a moment later reads the chain again.
      await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(balanceReads(b)).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 1600));
      await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(balanceReads(b)).toHaveLength(2);
    });

    it('tokens: a zero balance still returns the USDC row, so a deposit can be noticed', async () => {
      b = await boot();
      await call(b, 'GET', '/wallets/me', 'lev');
      chainReads(b, {});
      const r = await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(r.body.tokens).toEqual([expect.objectContaining({ mint: USDC, uiAmount: 0, usdValue: 0 })]);
    });

    it('tokens: a failed USDC read is a 503, never a zero, and is not cached', async () => {
      b = await boot();
      await call(b, 'GET', '/wallets/me', 'lev');
      chainReads(b, { [USDC]: 'fail', [EURC]: 'fail' });
      const r = await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ statusCode: 503, message: 'Your balance is loading. Try again in a moment.' });
      chainReads(b, { [USDC]: 7_000_000n, [EURC]: 'fail' });
      const next = await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(next.status).toBe(200);
      // EURC could not be read this time: left out, not shown as empty.
      expect(next.body.tokens).toEqual([expect.objectContaining({ mint: USDC, amount: '7000000', uiAmount: 7 })]);
    });

    it('tokens: reads the whole ledger when the store can answer it', async () => {
      const tokensForUser = jest.fn(async () => [MEME, USDC.toUpperCase().replace('0X', '0x'), 'not-an-address']);
      b = await boot({ tokensForUser });
      await call(b, 'GET', '/wallets/me', 'lev');
      chainReads(b, { [USDC]: 1n, [MEME]: 10n ** 18n }, { [MEME]: { decimals: 18, symbol: 'MEME', name: 'Meme' } });
      const r = await call(b, 'GET', '/wallets/tokens', 'lev');
      expect(tokensForUser).toHaveBeenCalledWith(people.lev.uid, 100);
      expect(b.actions.listForUser).not.toHaveBeenCalled();
      expect(r.body.tokens.map((t: any) => t.mint)).toEqual([USDC, MEME]);
      expect(balanceReads(b)[0].filter((a) => a === USDC)).toHaveLength(1);
    });

    it('transactions: swaps carry raw legs, deposits read in units, nothing-happened rows drop', async () => {
      b = await boot();
      await call(b, 'GET', '/wallets/me', 'lev');
      b.actions.listForUser.mockResolvedValue([
        action({
          id: 'buy1',
          kind: 'buy',
          status: 'confirmed',
          tokenIn: USDC,
          tokenOut: MEME,
          amountInRaw: '10000000',
          amountOutRaw: '20000000000000000000',
          legs: [
            { kind: 'approve', status: 'confirmed', chain: 'arc', txHash: '0x01' },
            { kind: 'swap', status: 'confirmed', chain: 'arc', txHash: '0xABC' },
          ],
        }),
        action({ id: 'nothing', kind: 'buy', status: 'failed', tokenIn: USDC, tokenOut: MEME, error: 'No route' }),
        action({
          id: 'dep1',
          kind: 'deposit',
          status: 'sent',
          tokenIn: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          tokenOut: USDC,
          amountInRaw: '25000000',
          legs: [
            { kind: 'burn', status: 'confirmed', chain: 'base', txHash: '0xb0' },
            { kind: 'mint', status: 'sent', chain: 'arc', txHash: '0xC0' },
          ],
        }),
        action({ id: 'sell1', kind: 'sell', status: 'pending', tokenIn: MEME, tokenOut: USDC, amountInRaw: '1' }),
        action({
          id: 'dep2',
          kind: 'deposit',
          status: 'sent',
          tokenOut: USDC,
          amountInRaw: '5000000',
          legs: [{ kind: 'burn', status: 'confirmed', chain: 'Ethereum', txHash: '0xe0' }],
        }),
        action({
          id: 'dep3',
          kind: 'deposit',
          status: 'failed',
          tokenOut: USDC,
          amountInRaw: '5000000',
          error: 'burn_reverted: the burn failed on chain and the money did not move: out of gas',
          legs: [{ kind: 'burn', status: 'failed', chain: 'Base', txHash: '0xe1' }],
        }),
      ]);
      const r = await call(b, 'GET', '/wallets/transactions?limit=15&offset=0', 'lev');
      expect(r.body.limit).toBe(15);
      expect(r.body.offset).toBe(0);
      const [buy, dep, sell, dep2, ...rest] = r.body.transactions;
      // dep3 failed on Base: nothing reached Arc, nothing to list.
      expect(rest).toHaveLength(0);
      // Only a Base burn so far: pending, and not linked to a hash Arc's explorer does not know.
      expect(dep2).toMatchObject({ id: 'dep2', signature: '', status: 'pending', amount: '5', error_message: null });
      expect(buy).toMatchObject({
        id: 'buy1',
        transaction_type: 'swap',
        signature: '0xabc',
        status: 'confirmed',
        token_mint: MEME,
        metadata: { chain: 'arc', inputMint: USDC, outputMint: MEME, inputAmount: '10000000', outputAmount: '20000000000000000000' },
      });
      expect(dep).toMatchObject({
        transaction_type: 'receive_token',
        signature: '0xc0',
        status: 'pending',
        amount: '25',
        token_mint: USDC,
        to_address: '0xabcdef0000000000000000000000000000000001',
      });
      expect(sell).toMatchObject({ transaction_type: 'swap', signature: '', status: 'pending', token_mint: MEME });

      const page = await call(b, 'GET', '/wallets/transactions?limit=1&offset=1', 'lev');
      expect(page.body.transactions.map((t: any) => t.id)).toEqual(['dep1']);
    });

    it('external-transfers: arrivals from the ledger, ok:false when it cannot look', async () => {
      b = await boot();
      b.actions.listForUser.mockResolvedValue([
        action({
          id: 'd1',
          kind: 'deposit',
          status: 'confirmed',
          tokenOut: USDC,
          amountInRaw: '25000000',
          amountOutRaw: '24990000',
          updatedAt: '2026-09-28T10:03:00.000Z',
          legs: [
            { kind: 'burn', status: 'confirmed', chain: 'Base', txHash: '0xb1' },
            { kind: 'mint', status: 'confirmed', chain: 'Arc', txHash: '0xC1', confirmedAt: '2026-09-28T10:02:59.000Z' },
          ],
        }),
      ]);
      const seed = await call(b, 'GET', '/wallets/external-transfers', 'lev');
      expect(seed.status).toBe(200);
      expect(seed.body).toEqual({
        ok: true,
        cursor: '2026-09-28T10:03:00.000Z|d1',
        transfers: [{ signature: '0xc1', direction: 'in', mint: USDC, amountUi: 24.99, at: '2026-09-28T10:02:59.000Z' }],
      });
      const later = await call(b, 'GET', `/wallets/external-transfers?until=${encodeURIComponent(seed.body.cursor)}`, 'lev');
      expect(later.body).toEqual({ ok: true, cursor: seed.body.cursor, transfers: [] });

      b.actions.listForUser.mockRejectedValue(new Error('db down'));
      const down = await call(b, 'GET', '/wallets/external-transfers', 'lev');
      expect(down.status).toBe(200);
      expect(down.body).toEqual({ ok: false, cursor: null, transfers: [] });
    });
  });

  describe('GET /arc/deposit-addresses', () => {
    it('answers Arc alone until the deposits service is wired', async () => {
      b = await boot();
      const r = await call(b, 'GET', '/arc/deposit-addresses', 'lev');
      expect(r.body).toEqual({ arc: { network: 'Arc', address: '0xabcdef0000000000000000000000000000000001' }, others: [] });
    });

    it('passes the other networks through, EVM lowercase, Solana untouched', async () => {
      const deposits = {
        depositAddresses: jest.fn(async () => ({
          arc: { network: 'Arc' as const, address: '0xAbCdEf0000000000000000000000000000000001' },
          others: [
            { network: 'Base', address: '0xAbCdEf0000000000000000000000000000000001' },
            { network: 'Solana', address: 'So1AnaAddrCaseMatters1111111111111111111111' },
          ],
        })),
      };
      b = await boot({ deposits });
      const r = await call(b, 'GET', '/arc/deposit-addresses', 'lev');
      expect(r.body).toEqual({
        arc: { network: 'Arc', address: '0xabcdef0000000000000000000000000000000001' },
        others: [
          { network: 'Base', address: '0xabcdef0000000000000000000000000000000001' },
          { network: 'Solana', address: 'So1AnaAddrCaseMatters1111111111111111111111' },
        ],
      });
      expect(deposits.depositAddresses).toHaveBeenCalledWith(people.lev.uid);
      expect(b.users.rows.has(people.lev.uid)).toBe(true);
    });
  });
});
