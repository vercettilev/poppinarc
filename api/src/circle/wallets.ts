import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { stableUuid } from './ids';

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
    const chain = this.config.network.walletsBlockchain;
    const existing = await this.find(uid, chain);
    if (existing) return existing;

    const walletSetId = await this.walletSetId();
    const res = await this.client.createWallets({
      walletSetId,
      blockchains: [chain],
      accountType: this.accountType,
      count: 1,
      metadata: [{ name: `poppin:${uid}`, refId: uid }],
      idempotencyKey: stableUuid('arc-wallet', this.config.network.name, uid),
    });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error('Circle returned no wallet');
    return this.store(uid, chain, w.id, w.address, this.accountType);
  }

  /**
   * A wallet on another EVM network with the SAME address as the user's Arc
   * wallet, so "send USDC to this address" is true on every network we list.
   */
  async ensureEvmDepositWallet(uid: string, blockchain: string): Promise<StoredWallet> {
    const existing = await this.find(uid, blockchain);
    if (existing) return existing;
    const arc = await this.ensureArcWallet(uid);
    const res = await this.client.deriveWallet({
      id: arc.walletId,
      blockchain: blockchain as never,
      metadata: { name: `poppin:${uid}:${blockchain}`, refId: `${uid}:${blockchain}` },
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

  /** A Solana wallet for money arriving from Solana. It has its own address. */
  async ensureSolanaDepositWallet(uid: string): Promise<StoredWallet> {
    const chain = this.config.network.name === 'mainnet' ? 'SOL' : 'SOL-DEVNET';
    const existing = await this.find(uid, chain);
    if (existing) return existing;
    const res = await this.client.createWallets({
      walletSetId: await this.walletSetId(),
      blockchains: [chain],
      accountType: 'EOA',
      count: 1,
      metadata: [{ name: `poppin:${uid}:sol`, refId: `${uid}:sol` }],
      idempotencyKey: stableUuid('sol-wallet', this.config.network.name, uid),
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
