import 'reflect-metadata';
import type { AppConfig } from '../config';
import type { DbService } from '../db/db.service';
import { ARC_NETWORKS } from '../arc/network';
import { circleRef } from './ids';
import { CircleWallets } from './wallets';

/**
 * Which Circle wallet each account gets, against a fake Circle and a fake
 * table: an EVM deposit wallet is always a smart account (derived from a
 * smart-account Arc wallet, its own otherwise), and the Solana funder is made
 * once and remembered.
 */
type Row = { uid: string; blockchain: string; wallet_id: string; address: string; account_type: 'EOA' | 'SCA' };

function fakeDb() {
  const wallets: Row[] = [];
  const settings = new Map<string, string>();
  const query = jest.fn(async (sql: string, p: unknown[] = []) => {
    if (sql.includes('FROM settings')) {
      const v = settings.get(String(p[0]));
      return v === undefined ? [] : [{ value: v }];
    }
    if (sql.includes('INSERT INTO settings')) {
      settings.set(String(p[0]), String(p[1]));
      return [];
    }
    if (sql.includes('FROM circle_wallets')) {
      return wallets.filter((w) => w.uid === p[0] && w.blockchain === p[1]);
    }
    if (sql.includes('INSERT INTO circle_wallets')) {
      if (!wallets.some((w) => w.uid === p[0] && w.blockchain === p[1])) {
        wallets.push({ uid: String(p[0]), blockchain: String(p[1]), wallet_id: String(p[2]), address: String(p[3]), account_type: p[4] as 'EOA' | 'SCA' });
      }
      return [];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { db: { query } as unknown as DbService, wallets, settings, query };
}

function setup(accountType: 'EOA' | 'SCA') {
  const config = {
    network: ARC_NETWORKS.testnet,
    circle: { apiKey: 'TEST_API_KEY:x:y', entitySecret: 'e'.repeat(64), accountType },
  } as unknown as AppConfig;
  const f = fakeDb();
  f.settings.set('circle_wallet_set:testnet', 'set-1');
  let n = 0;
  const addressOf = new Map<string, string>();
  const client = {
    createWallets: jest.fn(async (p: { blockchains: string[]; accountType: string }) => {
      const id = `w${++n}`;
      const address = `0x${String(n).padStart(40, 'a')}`;
      addressOf.set(id, address);
      return { data: { wallets: [{ id, address, blockchain: p.blockchains[0] }] } };
    }),
    // Circle derives the same address on the new network.
    deriveWallet: jest.fn(async (p: { id: string; blockchain: string }) => ({
      data: { wallet: { id: `d-${p.blockchain}`, address: addressOf.get(p.id)! } },
    })),
  };
  const w = new CircleWallets(config, f.db);
  Object.defineProperty(w, 'client', { get: () => client });
  return { w, client, f };
}

describe('EVM deposit wallets', () => {
  it('gives an EOA account a smart account of its own on the network', async () => {
    const { w, client } = setup('EOA');
    const uid = 'evm:0x78e07df0e361ddae634515334cc4a16acdcc1e36';
    const got = await w.ensureEvmDepositWallet(uid, 'BASE-SEPOLIA');
    expect(got).toMatchObject({ uid, blockchain: 'BASE-SEPOLIA', accountType: 'SCA' });
    expect(client.deriveWallet).not.toHaveBeenCalled();
    const call = client.createWallets.mock.calls.find(([p]) => p.blockchains[0] === 'BASE-SEPOLIA')![0] as unknown as {
      accountType: string;
      metadata: Array<{ name: string; refId: string }>;
    };
    expect(call.accountType).toBe('SCA');
    expect(call.metadata[0]).toEqual({ name: `poppin:${circleRef(uid)}:BASE-SEPOLIA`, refId: `${circleRef(uid)}-BASE-SEPOLIA` });
    // Asked again, it is the stored row, not a second wallet.
    await w.ensureEvmDepositWallet(uid, 'BASE-SEPOLIA');
    expect(client.createWallets.mock.calls.filter(([p]) => p.blockchains[0] === 'BASE-SEPOLIA')).toHaveLength(1);
  });

  it('derives from a smart-account Arc wallet, so the address is the same', async () => {
    const { w, client } = setup('SCA');
    const got = await w.ensureEvmDepositWallet('Xb3k9QmZt7VwP2rN8sLd4Hc1Ay0E', 'ETH-SEPOLIA');
    expect(client.deriveWallet).toHaveBeenCalled();
    expect(got.accountType).toBe('SCA');
  });
});

describe('the Solana funder', () => {
  it('is made once and remembered', async () => {
    const { w, client, f } = setup('EOA');
    const a = await w.ensureSolanaFunder();
    const b = await w.ensureSolanaFunder();
    expect(a).toBe(b);
    expect(f.settings.get('deposit_sol_funder:testnet')).toBe(a);
    const solCalls = client.createWallets.mock.calls.filter(([p]) => p.blockchains[0] === 'SOL-DEVNET');
    expect(solCalls).toHaveLength(1);
    expect(solCalls[0][0].accountType).toBe('EOA');
  });
});
