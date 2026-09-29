import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { circleErrorText, circleRef, stableUuid } from './ids';

/**
 * CIRCLE WALLETS: every Poppin on Arc account is a Circle developer-controlled
 * wallet.
 *
 * Circle holds the keys (MPC); this server holds only wallet ids and the
 * entity secret that authorises Circle to sign for them. There is no private
 * key anywhere in this codebase or its environment, which is the difference
 * from the Solana product, where the server decrypts a keypair to sign.
 *
 * One wallet set per network holds every user's wallets. A user's primary
 * wallet is on Arc; wallets on other networks exist only to RECEIVE money that
 * then moves to Arc (see circle/bridge.ts), and EVM ones share the Arc
 * wallet's address through `deriveWallet`.
 */

export type AccountType = 'EOA' | 'SCA';

export interface StoredWallet {
  uid: string;
  blockchain: string;
  walletId: string;
  address: string;
  accountType: AccountType;
  /**
   * The person's own wallet, not a Circle one (ownWalletOf). Nothing may be
   * sent from it by this service: it only reads it, and every buy and sell
   * is signed in the wallet itself.
   */
  own?: true;
}

/** The walletId an own wallet answers with; never a Circle id. */
export const OWN_WALLET_ID = 'own';

/**
 * An account that signed in with a wallet trades from that wallet when this
 * deploy says so (ARC_WALLET_ACCOUNTS=own). Its Arc wallet IS its address:
 * no Circle wallet is made, and every read of "the user's Arc wallet" answers
 * with it, so balances, positions and activity need no second path.
 */
export function ownWalletOf(config: Pick<AppConfig, 'walletAccounts' | 'network'>, uid: string): StoredWallet | null {
  if (config.walletAccounts !== 'own') return null;
  const m = /^evm:(0x[0-9a-f]{40})$/.exec(uid);
  if (!m) return null;
  return {
    uid,
    blockchain: config.network.walletsBlockchain,
    walletId: OWN_WALLET_ID,
    address: m[1]!,
    accountType: 'EOA',
    own: true,
  };
}

export interface ExecuteParams {
  walletId: string;
  contractAddress: `0x${string}`;
  callData: `0x${string}`;
  /** Native USDC value in 18-decimal units as a decimal string, rarely needed. */
  amount?: string;
  /** Derived from what the call is for, so a retry never sends twice. */
  idempotencyKey: string;
  refId?: string;
}

export interface ExecutedTx {
  circleTxId: string;
  txHash: `0x${string}`;
}

const SET_KEY = (network: string) => `circle_wallet_set:${network}`;

@Injectable()
export class CircleWallets {
  private readonly logger = new Logger('circle/wallets');
  private clientInstance: CircleDeveloperControlledWalletsClient | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.circle.apiKey && this.config.circle.entitySecret);
  }

  /** The Wallets API client, made on first use so a missing key is a 503, not a boot crash. */
  get client(): CircleDeveloperControlledWalletsClient {
    if (!this.configured) {
      throw new ServiceUnavailableException('Wallets are not set up yet');
    }
    this.clientInstance ??= initiateDeveloperControlledWalletsClient({
      apiKey: this.config.circle.apiKey!,
      entitySecret: this.config.circle.entitySecret!,
    });
    return this.clientInstance;
  }

  get accountType(): AccountType {
    return this.config.circle.accountType;
  }

  /** The wallet set for this network, created once and remembered. */
  async walletSetId(): Promise<string> {
    const net = this.config.network.name;
    const rows = await this.db.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [SET_KEY(net)]);
    if (rows[0]) return rows[0].value;

    const res = await this.client.createWalletSet({
      name: `poppin-arc-${net}`,
      idempotencyKey: stableUuid('wallet-set', net, this.config.circle.apiKey ?? ''),
    });
    const id = res.data?.walletSet.id;
    if (!id) throw new Error('Circle returned no wallet set id');
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [SET_KEY(net), id],
    );
    this.logger.log(`wallet set ready for ${net}: ${id}`);
    return id;
  }

  async find(uid: string, blockchain: string): Promise<StoredWallet | null> {
    if (blockchain === this.config.network.walletsBlockchain) {
      const own = ownWalletOf(this.config, uid);
      if (own) return own;
    }
    const rows = await this.db.query<{
      uid: string;
      blockchain: string;
      wallet_id: string;
      address: string;
      account_type: AccountType;
    }>('SELECT uid, blockchain, wallet_id, address, account_type FROM circle_wallets WHERE uid = $1 AND blockchain = $2', [
      uid,
      blockchain,
    ]);
    const r = rows[0];
    return r
      ? { uid: r.uid, blockchain: r.blockchain, walletId: r.wallet_id, address: r.address, accountType: r.account_type }
      : null;
  }

  /**
   * The user's Arc wallet, created on first sign-in. Safe to call on every
   * request: the stored row answers after the first time, and the creation
   * itself is idempotent per user, so two concurrent first requests end with
   * one wallet.
   */
  async ensureArcWallet(uid: string): Promise<StoredWallet> {
    const own = ownWalletOf(this.config, uid);
    if (own) return own;
    const chain = this.config.network.walletsBlockchain;
    const existing = await this.find(uid, chain);
    if (existing) return existing;

    const walletSetId = await this.walletSetId();
    const ref = circleRef(uid);
    const res = await this.client
      .createWallets({
        walletSetId,
        blockchains: [chain],
        accountType: this.accountType,
        count: 1,
        metadata: [{ name: `poppin:${ref}`, refId: ref }],
        idempotencyKey: stableUuid('arc-wallet', this.config.network.name, ref),
      })
      .catch((e: unknown) => {
        throw new Error(circleErrorText(e));
      });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error('Circle returned no wallet');
    return this.store(uid, chain, w.id, w.address, this.accountType);
  }

  /**
   * The user's deposit wallet on another EVM network: always a smart account,
   * because only a smart account has its gas paid (Gas Station) and the sweep
   * has to burn from it without anyone sending it ETH.
   *
   * When the Arc wallet is a smart account too, the deposit wallet is derived
   * from it and has the SAME address. When the Arc wallet is an EOA (every
   * account made so far), it is a smart account of its own on that network,
   * with its own address; the Add money card names each network's address.
   */
  async ensureEvmDepositWallet(uid: string, blockchain: string): Promise<StoredWallet> {
    const existing = await this.find(uid, blockchain);
    if (existing) return existing;
    const arc = await this.ensureArcWallet(uid);
    if (arc.own) throw new Error('an own wallet has no deposit wallets');
    if (arc.accountType !== 'SCA') return this.createSmartDepositWallet(uid, blockchain);
    const ref = circleRef(uid);
    const res = await this.client
      .deriveWallet({
        id: arc.walletId,
        blockchain: blockchain as never,
        metadata: { name: `poppin:${ref}:${blockchain}`, refId: `${ref}-${blockchain}` },
      })
      .catch((e: unknown) => {
        throw new Error(circleErrorText(e));
      });
    const w = res.data?.wallet;
    if (!w) throw new Error(`Circle returned no ${blockchain} wallet`);
    if (w.address.toLowerCase() !== arc.address.toLowerCase()) {
      // Promised in Circle's docs; checked anyway, because the whole screen
      // rests on it.
      throw new Error(`derived ${blockchain} wallet has a different address`);
    }
    return this.store(uid, blockchain, w.id, w.address, arc.accountType);
  }

  /** A smart account of the user's own on one EVM network, for an account whose Arc wallet is an EOA. */
  private async createSmartDepositWallet(uid: string, blockchain: string): Promise<StoredWallet> {
    const ref = circleRef(uid);
    const res = await this.client
      .createWallets({
        walletSetId: await this.walletSetId(),
        blockchains: [blockchain as never],
        accountType: 'SCA',
        count: 1,
        metadata: [{ name: `poppin:${ref}:${blockchain}`, refId: `${ref}-${blockchain}` }],
        idempotencyKey: stableUuid('sca-deposit', this.config.network.name, ref, blockchain),
      })
      .catch((e: unknown) => {
        throw new Error(circleErrorText(e));
      });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error(`Circle returned no ${blockchain} wallet`);
    return this.store(uid, blockchain, w.id, w.address, 'SCA');
  }

  /**
   * The wallet that sends SOL to Solana deposit wallets, made once per network
   * and remembered in settings (DEPOSIT_SOL_FUNDER=auto). It is ours, not a
   * user's; someone has to send it SOL (devnet SOL on testnet).
   */
  async ensureSolanaFunder(): Promise<string> {
    const net = this.config.network.name;
    const key = `deposit_sol_funder:${net}`;
    const rows = await this.db.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
    if (rows[0]) return rows[0].value;
    const res = await this.client
      .createWallets({
        walletSetId: await this.walletSetId(),
        blockchains: [net === 'mainnet' ? 'SOL' : 'SOL-DEVNET'],
        accountType: 'EOA',
        count: 1,
        metadata: [{ name: 'poppin:sol-funder', refId: 'sol-funder' }],
        idempotencyKey: stableUuid('sol-funder', net),
      })
      .catch((e: unknown) => {
        throw new Error(circleErrorText(e));
      });
    const address = res.data?.wallets?.[0]?.address;
    if (!address) throw new Error('Circle returned no Solana funder wallet');
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, address],
    );
    return address;
  }

  /** A Solana wallet for money arriving from Solana. It has its own address. */
  async ensureSolanaDepositWallet(uid: string): Promise<StoredWallet> {
    const chain = this.config.network.name === 'mainnet' ? 'SOL' : 'SOL-DEVNET';
    const existing = await this.find(uid, chain);
    if (existing) return existing;
    const ref = circleRef(uid);
    const res = await this.client
      .createWallets({
        walletSetId: await this.walletSetId(),
        blockchains: [chain],
        accountType: 'EOA',
        count: 1,
        metadata: [{ name: `poppin:${ref}:sol`, refId: `${ref}-sol` }],
        idempotencyKey: stableUuid('sol-wallet', this.config.network.name, ref),
      })
      .catch((e: unknown) => {
        throw new Error(circleErrorText(e));
      });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error('Circle returned no Solana wallet');
    return this.store(uid, chain, w.id, w.address, 'EOA');
  }

  /**
   * Run a contract call from a user's wallet and wait until it has a hash.
   * Confirmation is the caller's business (ArcChain.receipt), because a hash
   * is the first moment we have something to show and to record.
   */
  async execute(p: ExecuteParams, timeoutMs = 60_000): Promise<ExecutedTx> {
    const created = await this.client.createContractExecutionTransaction({
      walletId: p.walletId,
      contractAddress: p.contractAddress,
      callData: p.callData,
      ...(p.amount ? { amount: p.amount } : {}),
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: p.idempotencyKey,
      ...(p.refId ? { refId: p.refId } : {}),
    });
    const id = created.data?.id;
    if (!id) throw new Error('Circle returned no transaction id');
    const done = await this.client.getTransaction({
      id,
      waitForTxHash: true,
      pollingInterval: 250,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { circleTxId: id, txHash: done.data.transaction.txHash as `0x${string}` };
  }

  /** Testnet only: Circle's faucet, straight to a wallet, no captcha. */
  async faucet(address: string): Promise<void> {
    if (this.config.network.name !== 'testnet') throw new Error('faucet is testnet only');
    await this.client.requestTestnetTokens({
      address,
      blockchain: 'ARC-TESTNET',
      usdc: true,
      eurc: true,
    });
  }

  private async store(
    uid: string,
    blockchain: string,
    walletId: string,
    address: string,
    accountType: AccountType,
  ): Promise<StoredWallet> {
    await this.db.query(
      `INSERT INTO circle_wallets (uid, blockchain, wallet_id, address, account_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uid, blockchain) DO NOTHING`,
      [uid, blockchain, walletId, address, accountType],
    );
    // Re-read so two concurrent creators both return the row that won.
    return (await this.find(uid, blockchain))!;
  }
}
