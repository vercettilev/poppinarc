/**
 * Token Metadata Service
 *
 * Fetches and caches token metadata from Jupiter API
 * Provides lookup functionality to get token names, symbols, and logos by mint address
 */

export interface TokenMetadata {
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  tags?: string[]
}

interface CacheData {
  tokens: Map<string, TokenMetadata>
  timestamp: number
}

// Jupiter API response interface
interface JupiterToken {
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  tags?: string[]
  daily_volume?: number
}

const CACHE_KEY = 'jupiter_token_metadata_cache'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/all'

class TokenMetadataServiceClass {
  private tokenMap: Map<string, TokenMetadata> = new Map()
  private isLoading = false
  private loadPromise: Promise<void> | null = null

  /**
   * Initialize and load token metadata from cache or API
   */
  async initialize(): Promise<void> {
    // If already loading, return the existing promise
    if (this.loadPromise) {
      return this.loadPromise
    }

    // If already loaded, return immediately
    if (this.tokenMap.size > 0) {
      return Promise.resolve()
    }

    this.isLoading = true
    this.loadPromise = this.loadTokenMetadata()

    try {
      await this.loadPromise
    } finally {
      this.isLoading = false
      this.loadPromise = null
    }
  }

  /**
   * Load token metadata from cache or fetch from API
   */
  private async loadTokenMetadata(): Promise<void> {
    try {
      // Try to load from cache first
      const cached = this.loadFromCache()
      if (cached) {
        this.tokenMap = cached.tokens
        return
      }

      // Fetch from Jupiter API
      const response = await fetch(JUPITER_TOKEN_LIST_URL)

      if (!response.ok) {
        throw new Error(`Failed to fetch token list: ${response.statusText}`)
      }

      const tokens: JupiterToken[] = await response.json()

      // Build map for fast lookup
      this.tokenMap.clear()

      tokens.forEach(token => {
        this.tokenMap.set(token.address, {
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          logoURI: token.logoURI,
          tags: token.tags,
        })
      })

      // Save to cache
      this.saveToCache()

    } catch (error) {
      console.error('Failed to load token metadata', error)
      // Don't throw - allow app to continue with empty metadata
    }
  }

  /**
   * Load token metadata from localStorage cache
   */
  private loadFromCache(): CacheData | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (!cached) return null

      const data = JSON.parse(cached)
      const now = Date.now()

      // Check if cache is still valid
      if (now - data.timestamp > CACHE_DURATION) {
        localStorage.removeItem(CACHE_KEY)
        return null
      }

      // Reconstruct Map from cached array
      const tokens = new Map<string, TokenMetadata>(
        data.tokens.map((token: TokenMetadata) => [token.address, token])
      )

      return { tokens, timestamp: data.timestamp }
    } catch (error) {
      console.error('Error loading cache', error)
      localStorage.removeItem(CACHE_KEY)
      return null
    }
  }

  /**
   * Save token metadata to localStorage cache
   */
  private saveToCache(): void {
    try {
      const data = {
        tokens: Array.from(this.tokenMap.values()),
        timestamp: Date.now()
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Error saving cache', error)
      // Ignore cache save errors - not critical
    }
  }

  /**
   * Get token metadata by mint address
   * @param mintAddress The token mint address
   * @returns Token metadata or null if not found
   */
  getTokenMetadata(mintAddress: string): TokenMetadata | null {
    return this.tokenMap.get(mintAddress) || null
  }

  /**
   * Get multiple token metadata by mint addresses
   * @param mintAddresses Array of token mint addresses
   * @returns Map of mint address to token metadata
   */
  getTokenMetadataMap(mintAddresses: string[]): Map<string, TokenMetadata> {
    const result = new Map<string, TokenMetadata>()

    mintAddresses.forEach(address => {
      const metadata = this.tokenMap.get(address)
      if (metadata) {
        result.set(address, metadata)
      }
    })

    return result
  }

  /**
   * Check if token metadata is loaded
   */
  isLoaded(): boolean {
    return this.tokenMap.size > 0 && !this.isLoading
  }

  /**
   * Clear cache and reload from API
   */
  async refresh(): Promise<void> {
    localStorage.removeItem(CACHE_KEY)
    this.tokenMap.clear()
    await this.initialize()
  }
}

// Export singleton instance
export const TokenMetadataService = new TokenMetadataServiceClass()
