import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { privateKeyToAccount } from 'viem/accounts';
import { APP_CONFIG, type AppConfig } from '../config';
import { UsersService } from '../users/users.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { WalletAuthController } from './wallet.controller';
import { signWalletSession, verifyWalletSession, walletUid, WALLET_SESSION_MS } from './wallet-session';
import { CHALLENGE_MS, WalletSignin, WalletSigninRejected } from './wallet-signin';

/**
 * Sign-in with a wallet, end to end with a real signature: the server writes
 * the message, a key signs it the way a wallet does (personal_sign), the
 * server checks it once and hands back a session its own guard accepts.
 */
const SECRET = 'x'.repeat(40);
// Well-known test keys (Hardhat accounts 0 and 1); they guard nothing.
const alice = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const bob = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const DOMAIN = 'arc-api.example';
const URI = 'https://arc-api.example/api/v1/auth/wallet';

describe('wallet session', () => {
  it('round-trips, and names the account evm:<address>', () => {
    const t = signWalletSession(alice.address, SECRET, 1_000)
    const s = verifyWalletSession(t, SECRET, 2_000);
    expect(s).toMatchObject({ uid: walletUid(alice.address), address: alice.address.toLowerCase() });
    expect(s!.uid).toBe(`evm:${alice.address.toLowerCase()}`);
    expect(t.startsWith('arcw_')).toBe(true);
  });

  it('refuses a forged, altered, foreign or expired session', () => {
    const t = signWalletSession(alice.address, SECRET, 1_000);
    expect(verifyWalletSession(t, 'y'.repeat(40), 2_000)).toBeNull();
    expect(verifyWalletSession(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), SECRET, 2_000)).toBeNull();
    const [body, sig] = t.slice(5).split('.');
    const other = Buffer.from(JSON.stringify({ uid: walletUid(bob.address), address: bob.address.toLowerCase(), iat: 1_000, exp: 9e15 })).toString('base64url');
    expect(verifyWalletSession(`arcw_${other}.${sig}`, SECRET, 2_000)).toBeNull();
    expect(verifyWalletSession(`arcw_${body}.${sig}.x`, SECRET, 2_000)).toBeNull();
    expect(verifyWalletSession(t, SECRET, 1_000 + WALLET_SESSION_MS)).toBeNull();
    expect(verifyWalletSession('eyJhbGciOiJSUzI1NiJ9.e30.sig', SECRET, 2_000)).toBeNull();
  });
});

describe('wallet sign-in challenge', () => {
  const sign = (message: string, who = alice) => who.signMessage({ message });

  it('writes an EIP-4361 message for this host and accepts its signature once', async () => {
    const w = new WalletSignin();
    const message = w.challenge({ address: alice.address.toLowerCase(), chainId: 5042, domain: DOMAIN, uri: URI }, 1_000);
    expect(message.startsWith(`${DOMAIN} wants you to sign in with your Ethereum account:\n${alice.address}\n`)).toBe(true);
    expect(message).toContain('Chain ID: 5042');
    expect(message).toMatch(/Nonce: [A-Za-z0-9]{8,}/);
    const signature = await sign(message);
    await expect(w.verify({ message, signature }, 2_000)).resolves.toBe(alice.address.toLowerCase());
    // Single use.
    await expect(w.verify({ message, signature }, 2_000)).rejects.toThrow('That sign-in request expired. Try again.');
  });

  it('refuses another signer, an edited message, and a late signature', async () => {
    const w = new WalletSignin();
    const m1 = w.challenge({ address: alice.address, chainId: 1, domain: DOMAIN, uri: URI }, 1_000);
    await expect(w.verify({ message: m1, signature: await sign(m1, bob) }, 2_000)).rejects.toThrow('The signature does not match this wallet.');

    const m2 = w.challenge({ address: alice.address, chainId: 1, domain: DOMAIN, uri: URI }, 1_000);
    const edited = m2.replace('moves no money', 'moves money');
    await expect(w.verify({ message: edited, signature: await sign(edited) }, 2_000)).rejects.toThrow(WalletSigninRejected);

    const m3 = w.challenge({ address: alice.address, chainId: 1, domain: DOMAIN, uri: URI }, 1_000);
    await expect(w.verify({ message: m3, signature: await sign(m3) }, 1_000 + CHALLENGE_MS)).rejects.toThrow('That sign-in request expired. Try again.');
  });

  it('refuses what is not an address or a network', () => {
    const w = new WalletSignin();
    expect(() => w.challenge({ address: 'nope', chainId: 1, domain: DOMAIN, uri: URI })).toThrow('That is not a wallet address.');
    expect(() => w.challenge({ address: alice.address, chainId: 'x', domain: DOMAIN, uri: URI })).toThrow(WalletSigninRejected);
  });
});

describe('the guard', () => {
  const ctx = (authorization?: string) => {
    const req: { headers: Record<string, string>; user?: unknown } = { headers: authorization ? { authorization } : {} };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
  };
  const guard = (walletSessionSecret: string | null) =>
    new FirebaseAuthGuard({ firebaseProjectId: 'test-project', walletSessionSecret } as AppConfig);

  it('lets a wallet session through as its evm: account', async () => {
    const { req, ctx: c } = ctx(`Bearer ${signWalletSession(alice.address, SECRET)}`);
    await expect(guard(SECRET).canActivate(c)).resolves.toBe(true);
    expect(req.user).toEqual({ uid: walletUid(alice.address), email: null, name: null, picture: null });
  });

  it('turns away a wallet session when the secret is missing or different', async () => {
    const token = signWalletSession(alice.address, SECRET);
    await expect(guard(null).canActivate(ctx(`Bearer ${token}`).ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard('z'.repeat(40)).canActivate(ctx(`Bearer ${token}`).ctx)).rejects.toThrow(UnauthorizedException);
  });
});

describe('/auth/wallet over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const ensured: string[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WalletAuthController],
      providers: [
        WalletSignin,
        { provide: APP_CONFIG, useValue: { walletSessionSecret: SECRET } },
        { provide: UsersService, useValue: { ensure: async (u: { uid: string }) => (ensured.push(u.uid), { uid: u.uid }) } },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1/auth/wallet`;
  });
  afterAll(async () => {
    await app.close();
  });

  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  it('serves the page, never inside a frame', async () => {
    const r = await fetch(base);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await r.text();
    expect(html).toContain('Continue with a wallet');
    // The script is written inside a TS template literal, where a single
    // backslash is silently eaten: it must still parse, or the page lists nothing.
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('/^https:\\/\\//i');
    expect(html).toContain('eip6963:requestProvider');
    expect(html).toContain('POPPIN_ARC_WALLET_SIGNIN');
  });

  it('challenges for the host it was reached at, and turns a signature into a session', async () => {
    const c = await post('/challenge', { address: alice.address, chainId: 5042 });
    expect(c.status).toBe(200);
    const message = String(c.body.message);
    const host = new URL(base).host;
    expect(message.startsWith(`${host} wants you to sign in`)).toBe(true);
    expect(message).toContain(`URI: http://${host}/api/v1/auth/wallet`);
    const v = await post('/verify', { message, signature: await alice.signMessage({ message }) });
    expect(v.status).toBe(200);
    expect(v.body.uid).toBe(walletUid(alice.address));
    expect(verifyWalletSession(String(v.body.token), SECRET)?.uid).toBe(walletUid(alice.address));
    expect(ensured).toContain(walletUid(alice.address));
  });

  it('answers a bad signature with a sentence', async () => {
    const c = await post('/challenge', { address: alice.address, chainId: 1 });
    const message = String(c.body.message);
    const v = await post('/verify', { message, signature: await bob.signMessage({ message }) });
    expect(v.status).toBe(400);
    expect(v.body.message).toBe('The signature does not match this wallet.');
  });
});
