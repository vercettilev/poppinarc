import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FarTrades } from '../far/far-trades';
import { RemoteTokens } from './remote-tokens';
import { RouteQuotes } from './route-quotes';
import { RoutesController } from './routes.controller';

beforeAll(() => Logger.overrideLogger(false));

const BRETT = 'remote:base:0x532f27101965dd16442e59d40670faf5ebb142e4';

/** Through Nest's own injection: a far service the controller cannot see would leave every route a preview. */
async function controller(opens: boolean) {
  const mod = await Test.createTestingModule({
    controllers: [RoutesController],
    providers: [
      { provide: RouteQuotes, useValue: { preview: async () => ({ asset: { chain: 'Base' }, available: false, note: 'comes next' }) } },
      { provide: RemoteTokens, useValue: { assetOf: async () => ({ asset: { chain: 'base', address: '0x532f27101965dd16442e59d40670faf5ebb142e4' } }) } },
      { provide: FarTrades, useValue: { opensFor: () => opens } },
    ],
  }).compile();
  return mod.get(RoutesController);
}

describe('RoutesController', () => {
  it('marks a route buyable where the far trades open it, and leaves the rest a preview', async () => {
    expect(await (await controller(true)).route({ mint: BRETT })).toMatchObject({ available: true, note: expect.stringContaining('paid in USDC') });
    expect(await (await controller(false)).route({ mint: BRETT })).toMatchObject({ available: false, note: 'comes next' });
  });
});
