import { sendApiRequest } from "~/lib/fetchService"

// ==================== Types ====================

export type TokenCategory = 'recent' | 'toptrending' | 'toptraded' | 'toporganicscore'

export interface TerminalToken {
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  price?: string
  priceChange24h?: string
  marketCap?: string
  volume24h?: string
  liquidity?: string
  createdAt?: string
  txCount?: number
  holders?: number
  buyRatio?: number // 0-100 representing buy vs sell ratio
  tags?: string[]
  twitter?: string // Twitter handle or URL
  website?: string // Website URL
}

export interface TerminalPagination {
  page: number
  limit: number
  total: number
  hasNext: boolean
}

export interface TerminalTokensResponse {
  tokens: TerminalToken[]
  pagination: TerminalPagination
}

export interface TerminalTokenSearchResult {
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  tags?: string[]
  daily_volume?: number
}

export interface TokenPriceInfo {
  price: string
  extraInfo?: {
    lastSwappedPrice?: {
      lastJupiterSellAt?: number
      lastJupiterSellPrice?: string
      lastJupiterBuyAt?: number
      lastJupiterBuyPrice?: string
    }
    quotedPrice?: {
      buyPrice?: string
      buyAt?: number
      sellPrice?: string
      sellAt?: number
    }
    confidenceLevel?: string
  }
}

export interface SwapQuoteResult {
  inputMint: string
  outputMint: string
  inputAmount: string
  outputAmount: string
  priceImpact: string
  minimumReceived: string
  route: string[]
  fee?: string
}

export interface SwapResult {
  signature: string
  inputMint: string
  outputMint: string
  inputAmount: string
  outputAmount: string
}

// ==================== Request Params ====================

export interface GetTokensParams {
  category?: TokenCategory
  page?: number
  limit?: number
  search?: string
}

export interface SearchTokensParams {
  query: string
  limit?: number
}

export interface GetSwapQuoteParams {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps?: number
  swapMode?: 'ExactIn' | 'ExactOut'
}

export interface ExecuteSwapParams {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps?: number
  swapMode?: 'ExactIn' | 'ExactOut'
  priorityFee?: number | 'auto'
}

// ==================== Constants ====================

export const TERMINAL_CONSTANTS = {
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  DEFAULT_SLIPPAGE_BPS: 50, // 0.5%
  TOKEN_CATEGORIES: ['recent', 'toptrending', 'toptraded', 'toporganicscore'] as const,
} as const

// ==================== Service Class ====================

export class TerminalService {
  /**
   * Get tokens by category (recent, toptrending, toptraded, toporganicscore)
   */
  public static async getTokens(params?: GetTokensParams): Promise<TerminalTokensResponse> {
    const queryParams = new URLSearchParams()
    if (params?.category) queryParams.append('category', params.category)
    if (params?.page) queryParams.append('page', String(params.page))
    if (params?.limit) queryParams.append('limit', String(params.limit))
    if (params?.search) queryParams.append('search', params.search)

    const url = queryParams.toString()
      ? `/terminal/tokens?${queryParams.toString()}`
      : '/terminal/tokens'

    return sendApiRequest<TerminalTokensResponse>({
      url,
      method: 'GET',
    })
  }

  /**
   * Search tokens by name, symbol, or mint address
   */
  public static async searchTokens(params: SearchTokensParams): Promise<TerminalTokenSearchResult[]> {
    const queryParams = new URLSearchParams()
    queryParams.append('query', params.query)
    if (params.limit) queryParams.append('limit', String(params.limit))

    return sendApiRequest<TerminalTokenSearchResult[]>({
      url: `/terminal/tokens/search?${queryParams.toString()}`,
      method: 'GET',
    })
  }

  /**
   * Get single token info by mint address
   */
  public static async getTokenInfo(mintAddress: string): Promise<TerminalToken | null> {
    return sendApiRequest<TerminalToken | null>({
      url: `/terminal/tokens/${mintAddress}`,
      method: 'GET',
    })
  }

  /**
   * Get prices for multiple tokens
   */
  public static async getTokenPrices(
    mintAddresses: string[],
    showExtraInfo = false
  ): Promise<{ [mint: string]: TokenPriceInfo }> {
    const queryParams = new URLSearchParams()
    queryParams.append('ids', mintAddresses.join(','))
    if (showExtraInfo) queryParams.append('showExtraInfo', 'true')

    return sendApiRequest<{ [mint: string]: TokenPriceInfo }>({
      url: `/terminal/prices?${queryParams.toString()}`,
      method: 'GET',
    })
  }

  /**
   * Get swap quote without executing
   */
  public static async getSwapQuote(params: GetSwapQuoteParams): Promise<SwapQuoteResult> {
    const queryParams = new URLSearchParams()
    queryParams.append('inputMint', params.inputMint)
    queryParams.append('outputMint', params.outputMint)
    queryParams.append('amount', params.amount)
    if (params.slippageBps) queryParams.append('slippageBps', String(params.slippageBps))
    if (params.swapMode) queryParams.append('swapMode', params.swapMode)

    return sendApiRequest<SwapQuoteResult>({
      url: `/terminal/quote?${queryParams.toString()}`,
      method: 'GET',
    })
  }

  /**
   * Execute a token swap
   * Requires authentication
   */
  public static async executeSwap(params: ExecuteSwapParams): Promise<SwapResult> {
    return sendApiRequest<SwapResult>({
      url: '/terminal/swap',
      method: 'POST',
      data: params,
    })
  }
}
