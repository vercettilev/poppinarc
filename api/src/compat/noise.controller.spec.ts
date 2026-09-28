import 'reflect-metadata';
import { Controller, HttpCode, INestApplication, Module, ModuleMetadata, Post } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { NoiseController, NoiseModule, ORDER_REFUSALS } from './noise.controller';

/**
 * Every call goes out WITHOUT a token, the way a signed-out reader's
 * extension sends it: none of these routes may answer 401.
 */

async function boot(meta: ModuleMetadata): Promise<{ app: INestApplication; base: string }> {
  const mod = await Test.createTestingModule(meta).compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${addr.port}/api/v1` };
}

let app: INestApplication;
let base: string;

// Mounted the only supported way, through NoiseModule.
beforeAll(async () => {
  ({ app, base } = await boot({ imports: [NoiseModule] }));
});

afterAll(async () => {
  await app?.close();
});

async function call(method: string, path: string, body?: unknown, at: string = base) {
  const res = await fetch(`${at}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

describe('NoiseController', () => {
  it('has no guard anywhere', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, NoiseController)).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(NoiseController.prototype)) {
      const fn = (NoiseController.prototype as unknown as Record<string, unknown>)[name];
      expect(Reflect.getMetadata(GUARDS_METADATA, fn as object)).toBeUndefined();
    }
  });

  describe('telemetry', () => {
    const event = {
      event_type: 'card_shown',
      anon_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      metadata: { event: 'x_chip_shown', mint: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
    };

    it('accepts and drops a signed-out event without asking for sign-in', async () => {
      expect(await call('POST', '/user-events', event)).toMatchObject({ status: 200, body: { recorded: false } });
    });

    it('accepts the anonymous route too', async () => {
      expect(await call('POST', '/user-events/anon', event)).toMatchObject({ status: 200, body: { recorded: false } });
    });

    it('takes an empty or odd body without a 400', async () => {
      expect((await call('POST', '/user-events')).status).toBe(200);
      expect((await call('POST', '/user-events', { event_type: 'not_a_type' })).status).toBe(200);
    });
  });

  describe('presence', () => {
    it('site presence is a real 404, never a 200 with a null count', async () => {
      const r = await call('POST', '/site-chat/presence/ping', { host: 'x.com', anonId: 'abc' });
      expect(r.status).toBe(404);
      expect(r.body.count).toBeUndefined();
    });

    it('the chat ticket is a 404 too', async () => {
      expect((await call('POST', '/site-chat/ticket')).status).toBe(404);
    });

    it('page presence is zero, which both callers hide', async () => {
      expect(await call('GET', '/ticks/pages/x.com/presence')).toEqual({
        status: 200,
        text: '{"onlineCount":0}',
        body: { onlineCount: 0 },
      });
      expect((await call('GET', `/ticks/pages/${encodeURIComponent('www.coindesk.com')}/presence`)).body).toEqual({
        onlineCount: 0,
      });
    });
  });

  it('the bell has no social rows', async () => {
    expect(await call('GET', '/users/me/notifications?limit=20')).toMatchObject({
      status: 200,
      body: { data: [], meta: { hasNextPage: false } },
    });
  });

  describe('points, referrals, streaks', () => {
    it('the leaderboard is empty with no rank, echoing the period', async () => {
      const week = await call('GET', '/flywheel/leaderboard?period=week&limit=1');
      expect(week).toMatchObject({
        status: 200,
        body: {
          period: 'week',
          rows: [],
          viewer: null,
          viewerRank: null,
          viewerNext: null,
          weights: [],
          allTimeSince: null,
        },
      });
      expect((await call('GET', '/flywheel/leaderboard?period=all&limit=5')).body.period).toBe('all');
      expect((await call('GET', '/flywheel/leaderboard?period=decade')).body.period).toBe('week');
      expect((await call('GET', '/flywheel/leaderboard')).body.period).toBe('week');
    });

    it('the pool claims no seat and a multiplier of 1', async () => {
      const r = await call('GET', '/flywheel/pool');
      expect(r).toMatchObject({
        status: 200,
        body: {
          pool: { poolUsd: 0, viewerCohortMult: 1, viewerShareUsd: null, viewerCohortRank: null },
          seatsLeft: 0,
        },
      });
    });

    it('referral stats are 204 with no body, so the invite row stays hidden', async () => {
      const r = await call('GET', '/referrals/stats');
      expect(r.status).toBe(204);
      expect(r.text).toBe('');
    });

    it('streaks answer an empty list in every query spelling', async () => {
      for (const q of ['?user_ids[]=a&user_ids[]=b', '?user_ids=a&user_ids=b', '?user_ids=a', '']) {
        expect(await call('GET', `/streaks/user-streaks${q}`)).toMatchObject({ status: 200, body: [] });
      }
    });
  });

  describe('social boards', () => {
    it.each([
      ['/spot/social/callers?period=week&limit=50', { callers: [] }],
      ['/spot/social/following-trades?since=1790000000000', { trades: [] }],
      ['/spot/social/following-trades?days=7&limit=100', { trades: [] }],
      ['/spot/social/top-wins?limit=12', { wins: [] }],
      ['/spot/social/my-wins?limit=5', { wins: [] }],
      ['/spot/social/wins/uid_someone?limit=5', { wins: [] }],
      [`/website-post/consensus?website_url=${encodeURIComponent('https://x.com/home')}`, { mint: null }],
      ['/website-post/consensus', { mint: null }],
    ])('GET %s', async (path, shape) => {
      expect(await call('GET', path)).toMatchObject({ status: 200, body: shape });
    });
  });

  describe('order watch and alerts', () => {
    it('both order lists are empty', async () => {
      expect(await call('POST', '/embed/asset/orders', { status: 'active' })).toMatchObject({
        status: 200,
        body: { orders: [] },
      });
      expect(await call('POST', '/embed/asset/orders', { status: 'history' })).toMatchObject({
        status: 200,
        body: { orders: [] },
      });
    });

    it('fills/seen closes nothing', async () => {
      expect(await call('POST', '/embed/asset/fills/seen', { orderKeys: ['k1'] })).toMatchObject({
        status: 200,
        body: { closed: 0 },
      });
    });

    it('the alerts list is empty with a fired array the client can read', async () => {
      const r = await call('GET', '/embed/asset/alerts');
      expect(r).toMatchObject({ status: 200, body: { open: [], fired: [] } });
      expect(Array.isArray(r.body.fired)).toBe(true);
    });

    it('sync keeps nothing, and a later read still shows nothing', async () => {
      const mint = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const alert = {
        id: `${mint}:0.5:1790000000000`,
        mint,
        symbol: 'ABC',
        targetUsd: 0.5,
        direction: 'above',
        createdAt: 1790000000000,
      };
      expect(await call('POST', '/embed/asset/alerts/sync', { alerts: [alert] })).toMatchObject({
        status: 200,
        body: { kept: 0 },
      });
      expect((await call('GET', '/embed/asset/alerts')).body).toEqual({ open: [], fired: [] });
    });

    it('remove and fired acknowledge with ok', async () => {
      expect(await call('POST', '/embed/asset/alerts/remove', { id: 'x' })).toMatchObject({
        status: 200,
        body: { ok: true },
      });
      expect(await call('POST', '/embed/asset/alerts/fired', { id: 'x', atUsd: 1.2 })).toMatchObject({
        status: 200,
        body: { ok: true },
      });
    });
  });

  describe('placing and cancelling orders', () => {
    const place = { mint: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', side: 'buy', amountUsd: 25, triggerPriceUsd: 0.5 };

    it.each([
      ['/embed/asset/order', place, ORDER_REFUSALS.place],
      ['/embed/asset/order/external/prepare', place, ORDER_REFUSALS.place],
      ['/embed/asset/order/external/submit', { preparedId: 'p1', signature: '0xsig' }, ORDER_REFUSALS.place],
      ['/embed/asset/order/cancel', { orderKey: 'k1' }, ORDER_REFUSALS.cancel],
      ['/embed/asset/order/cancel/external/prepare', { orderKey: 'k1' }, ORDER_REFUSALS.cancel],
    ])('POST %s refuses with a sentence, not a route', async (path, body, sentence) => {
      const r = await call('POST', path, body);
      // 404, never 401/403: those read as "Sign in to trade" and force a token refresh.
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(sentence);
      expect(r.text).not.toMatch(/Cannot POST|api\/v1/);
    });

    // The client's own filter (extension-new/src/helpers/refusalCopy.ts) drops
    // anything that reads like a log line; these are its rules, restated.
    it.each(Object.values(ORDER_REFUSALS))('%s reads as a sentence the client passes through', (m) => {
      expect(m).toMatch(/^[A-Z]/);
      expect(m.length).toBeLessThan(120);
      expect(m).not.toMatch(/\b[a-z]+[A-Z][A-Za-z]*\b/);
      expect(m).not.toMatch(/[a-z]_[a-z]/i);
      expect(m).not.toMatch(/\s[\u2014-]\s|\u2014/);
      expect(m).not.toMatch(/\b(null|undefined|NaN|TypeError|fetch|HTTP|status code|JSON|RPC|Instruction)\b/i);
      expect(m).not.toMatch(/0x[0-9a-f]{2,}|insufficient|slippage/i);
    });
  });

  it('answers fresh objects, so one caller cannot change what the next one sees', async () => {
    const c = new NoiseController();
    const a = c.alerts();
    (a.fired as unknown[]).push({ id: 'leak' });
    expect(c.alerts().fired).toEqual([]);
  });
});

/**
 * Route order. Nest registers the root module's own controllers first, then
 * its imports depth first, and on a duplicate path the first registration
 * answers. A stand-in for a future real `embed/asset/orders` proves the stub
 * steps aside when mounted through NoiseModule last, whichever way the real
 * controller is mounted, and pins the trap that makes a `controllers` array
 * the wrong place for it.
 */
describe('NoiseModule registration order', () => {
  @Controller('embed/asset')
  class RealOrdersController {
    @Post('orders')
    @HttpCode(200)
    orders() {
      return { orders: [{ orderKey: 'real' }] };
    }
  }

  @Module({ controllers: [RealOrdersController] })
  class RealOrdersModule {}

  async function whoAnswers(meta: ModuleMetadata): Promise<unknown> {
    const booted = await boot(meta);
    try {
      return (await call('POST', '/embed/asset/orders', { status: 'active' }, booted.base)).body;
    } finally {
      await booted.app.close();
    }
  }

  const real = { orders: [{ orderKey: 'real' }] };

  it('a real route in a module imported before NoiseModule wins', async () => {
    expect(await whoAnswers({ imports: [RealOrdersModule, NoiseModule] })).toEqual(real);
  });

  it("a real route in the root module's own controllers wins", async () => {
    expect(await whoAnswers({ controllers: [RealOrdersController], imports: [NoiseModule] })).toEqual(real);
  });

  it('the trap: listed in root controllers, the stub shadows a real route in any imported module', async () => {
    expect(await whoAnswers({ controllers: [NoiseController], imports: [RealOrdersModule] })).toEqual({ orders: [] });
  });
});
