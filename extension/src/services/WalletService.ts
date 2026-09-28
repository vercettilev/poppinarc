import { sendApiRequest } from "~/lib/fetchService"

export interface UserWallet {
  id: string
  user_id: string
  public_key: string
  wallet_type: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface WalletBalance {
  publicKey: string
  balance: {
    lamports: number
    sol: number
  }
}

export interface Token {
  mint: string
  amount: string
  decimals: number
  uiAmount: number
  slot: number
  isFrozen: boolean
  // Metadata from Jupiter Ultra API
  name: string
  symbol: string
  logoURI: string | null
  // Price data
  price: number | null
  usdValue: number | null
  // Market data
  isVerified: boolean
  tags: string[]
  marketCap: number | null
  fdv: number | null
  liquidity: number | null
  holderCount: number | null
  // Stats
  priceChange24h: number | null
  volume24h: number | null
  // Social links
  twitter: string | null
  discord: string | null
  website: string | null
  // Additional info
  organicScore: number | null
  organicScoreLabel: string | null
}

export interface TokensResponse {
  publicKey: string
  tokens: Token[]
}

export interface WalletTransaction {
  id: string
  transaction_type: "send_sol" | "receive_sol" | "send_token" | "receive_token" | "send_nft" | "receive_nft" | "swap"
  signature: string
  from_address: string
  to_address: string
  amount: string
  token_mint?: string
  nft_mint?: string
  status: "pending" | "confirmed" | "failed"
  error_message?: string
  metadata?: string
  created_at: string
  updated_at: string
}

export interface TransactionsResponse {
  transactions: WalletTransaction[]
  limit: number
  offset: number
}

export interface TransferSOLParams {
  to?: string // Recipient wallet address (required if to_user_id not provided)
  to_user_id?: string // Recipient user ID (will look up wallet address)
  post_id?: string // Post ID if tipping from a post (for tipper badge)
  amount: number
}

export interface TransferTokenParams {
  to?: string // Recipient wallet address (required if to_user_id not provided)
  to_user_id?: string // Recipient user ID (will look up wallet address)
  post_id?: string // Post ID if tipping from a post (for tipper badge)
  mint: string
  amount: number
}

export interface SignMessageParams {
  message: string
}

export interface AirdropParams {
  amount: number
}

export interface TokenPrice {
  id: string
  mint_address: string
  symbol: string
  name: string
  usd_price: string
  usd_24h_change?: string
  market_cap?: string
  volume_24h?: string
  last_updated: string
  created_at: string
  updated_at: string
}

export interface TokenPricesResponse {
  success: boolean
  data: TokenPrice[]
}

export class WalletService {
  /**
   * Get current user's wallet information
   * @returns Promise with wallet data
   */
  public static async getMyWallet() {
    return sendApiRequest<{
      exists: boolean
      wallet?: UserWallet
      message?: string
    }>({
      url: "/wallets/me",
      method: "GET",
    })
  }

  /**
   * Provision the user's wallets.
   * Idempotent on the backend — safe to call from a Retry button when
   * the empty-wallet screen shows up. Returns the freshly-created (or
   * already-existing) wallet records.
   */
  public static async provisionWallets() {
    return sendApiRequest<{
      success: boolean
      solana: UserWallet
      evm: UserWallet
    }>({
      url: "/wallets/provision",
      method: "POST",
    })
  }

  /**
   * Get wallet balance
   * @returns Promise with balance data
   */
  public static async getBalance() {
    return sendApiRequest<WalletBalance>({
      url: "/wallets/balance",
      method: "GET",
    })
  }

  /**
   * Get all SPL tokens in wallet
   * @returns Promise with tokens data
   */
  public static async getTokens() {
    return sendApiRequest<TokensResponse>({
      url: "/wallets/tokens",
      method: "GET",
    })
  }

  /**
   * Transfer SOL to another address
   * @param params Transfer parameters
   * @returns Promise with transaction signature
   */
  public static async transferSOL(params: TransferSOLParams) {
    return sendApiRequest<{
      success: boolean
      signature: string
      message: string
    }>({
      url: "/wallets/transfer/sol",
      method: "POST",
      data: params,
    })
  }

  /**
   * Transfer SPL token to another address
   * @param params Transfer parameters
   * @returns Promise with transaction signature
   */
  public static async transferToken(params: TransferTokenParams) {
    return sendApiRequest<{
      success: boolean
      signature: string
      message: string
    }>({
      url: "/wallets/transfer/token",
      method: "POST",
      data: params,
    })
  }

  /**
   * Sign a message with wallet
   * @param params Message to sign
   * @returns Promise with signature
   */
  public static async signMessage(params: SignMessageParams) {
    return sendApiRequest<{
      success: boolean
      publicKey: string
      message: string
      signature: string
    }>({
      url: "/wallets/sign-message",
      method: "POST",
      data: params,
    })
  }

  /**
   * THE SENTENCE THE SERVER WILL VERIFY, asked for rather than composed.
   *
   * auth/wallet-signin.util.ts builds this string and checks an ed25519
   * signature over exactly its bytes. Writing a second copy of the wording
   * here would mean two implementations having to agree forever, and the
   * one that drifts produces signatures that verify against nothing with no
   * clue why. Public route: it hands out text, not a credential.
   */
  /**
   * THE SENTENCE THAT BINDS THE WALLET TO *THIS* ACCOUNT.
   *
   * Not /auth/wallet/message, which is the SIGNING-IN sentence: it names the
   * wallet and the time and no account, because when you sign in the address
   * IS the account. Posting that proof to connect would let anyone holding
   * it inside its ten-minute window attach somebody else's wallet to their
   * own account. This route is authenticated and names the account inside
   * the bytes the wallet displays, so a proof made for one account verifies
   * against no other — and the text itself says trades will come from here,
   * rather than the read-only promise the watch-only sentence makes.
   */
  public static async walletSignInSentence(address: string) {
    return sendApiRequest<{ isoTime: string; message: string }>({
      url: "/wallets/linked/message",
      method: "GET",
      params: { purpose: "trade", address },
    })
  }

  /**
   * ATTACH THAT WALLET TO THE ACCOUNT ALREADY SIGNED IN, and trade from it.
   *
   * Only the address travels; WHOSE account it joins is the Firebase token's
   * and nothing in this body. The server refuses three ways in words meant
   * to be printed as they arrive (an address another account owns, a Poppin
   * wallet that still holds money, an account already trading from a
   * wallet), so callers show `message` rather than a sentence of their own.
   */
  public static async connectTradingWallet(proof: {
    address: string
    signature: string
    isoTime: string
  }) {
    return sendApiRequest<{ wallet_mode: string; external_address: string | null }>({
      url: "/wallets/linked/connect",
      method: "POST",
      data: proof,
    })
  }

  /** And back to the Poppin wallet, so the choice is never a one-way door. */
  public static async disconnectTradingWallet() {
    return sendApiRequest<{ wallet_mode: string; external_address: string | null }>({
      url: "/wallets/linked/disconnect",
      method: "POST",
    })
  }

  /**
   * Get transaction history
   * @param limit Number of transactions to fetch
   * @param offset Pagination offset
   * @returns Promise with transactions data
   */
  public static async getTransactions(limit: number = 50, offset: number = 0) {
    return sendApiRequest<TransactionsResponse>({
      url: "/wallets/transactions",
      method: "GET",
      params: { limit, offset },
    })
  }

  /**
   * Request airdrop (devnet/testnet only)
   * @param params Airdrop parameters
   * @returns Promise with transaction signature
   */
  public static async requestAirdrop(params: AirdropParams) {
    return sendApiRequest<{
      success: boolean
      signature: string
      message: string
    }>({
      url: "/wallets/airdrop",
      method: "POST",
      data: params,
    })
  }

  /**
   * Export private key in base58 format
   * @returns Promise with private key and instructions
   */
  public static async exportPrivateKey() {
    return sendApiRequest<{
      success: boolean
      publicKey: string
      privateKey: string
      format: string
      warning: string
      instructions: {
        phantom: string
        solflare: string
      }
    }>({
      url: "/wallets/export-private-key",
      method: "POST",
    })
  }

  /**
   * Get token prices for multiple tokens
   * @param mintAddresses Array of token mint addresses
   * @returns Promise with token prices
   */
  public static async getTokenPrices(mintAddresses: string[]) {
    return sendApiRequest<TokenPricesResponse>({
      url: "/token-prices/batch",
      method: "POST",
      data: { mintAddresses },
    })
  }

  /**
   * Get list of user IDs who have tipped on a specific post
   * @param postId Post ID
   * @returns Promise with tipper IDs
   */
  public static async getTippersForPost(postId: string) {
    return sendApiRequest<{
      postId: string
      tipperIds: string[]
    }>({
      url: `/wallets/tippers/${postId}`,
      method: "GET",
    })
  }

  // ===================== EVM KEY EXPORT =====================
  //
  // The EVM address behind this endpoint is the user's
  // Polymarket DEPOSIT WALLET (smart contract), not the owner EOA. Backend
  // resolves the deposit wallet on every read; frontend just displays it.
  //
  // Removed under Polymarket V2 Phase 1:
  // Gas is paid by the Polymarket relayer for every wallet operation
  // (deploy, approvals, wrap, redeem, fee transfer), so EOA-direct
  // transfers and 1inch swap are dead code.

  /**
   * Export the OWNER EOA private key. The owner EOA controls the deposit
   * wallet via ERC-1271 signature validation, so this key is essentially
   * the recovery key for the user's Polymarket trading wallet. Surfaced
   * as an "advanced / recovery" feature.
   */
  public static async exportEvmPrivateKey() {
    return sendApiRequest<{
      success: boolean
      address: string
      privateKey: string
      format: string
      warning: string
      instructions: { metamask: string }
    }>({
      url: "/wallets/polygon/export-private-key",
      method: "POST",
    })
  }
}
