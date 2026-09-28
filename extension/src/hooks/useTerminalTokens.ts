import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { TerminalService, TokenCategory, TerminalTokensResponse, TerminalToken } from "~/services/TerminalService"

export interface UseTerminalTokensParams {
  category?: TokenCategory
  limit?: number
  search?: string
  enabled?: boolean
  refetchInterval?: number | false
}

export function useTerminalTokens(params: UseTerminalTokensParams = {}) {
  const { category = 'recent' as TokenCategory, limit = 20, search, enabled = true, refetchInterval = 30000 } = params

  return useQuery({
    queryKey: ['terminal-tokens', category, limit, search],
    queryFn: async () => {
      const response = await TerminalService.getTokens({
        category,
        limit,
        search,
        page: 1,
      })
      return response
    },
    enabled,
    /**
     * KEEP THE OLD LIST WHILE THE NEW ONE LOADS. Every category tap and
     * settled keystroke is a new key, so isLoading went true, the whole
     * list unmounted, and the room showed bare "Loading…" - a full
     * teleport for a one-chip change, twice a browse minute. The stale
     * rows stay (dimmed by the view) until the fresh ones land.
     */
    placeholderData: keepPreviousData,
    staleTime: 30000, // 30 seconds
    refetchInterval, // Auto-refresh interval (can be disabled with false)
  })
}

export function useInfiniteTerminalTokens(params: UseTerminalTokensParams = {}) {
  const { category = 'recent' as TokenCategory, limit = 20, search, enabled = true } = params

  return useInfiniteQuery({
    queryKey: ['terminal-tokens-infinite', category, limit, search],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await TerminalService.getTokens({
        category,
        limit,
        search,
        page: pageParam,
      })
      return response
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.pagination.hasNext) {
        return allPages.length + 1
      }
      return undefined
    },
    enabled,
    staleTime: 30000,
  })
}

export function useTokenInfo(mintAddress: string, enabled = true) {
  return useQuery({
    queryKey: ['terminal-token', mintAddress],
    queryFn: async () => {
      const response = await TerminalService.getTokenInfo(mintAddress)
      return response
    },
    enabled: enabled && !!mintAddress,
    staleTime: 60000, // 1 minute
  })
}

export function useTokenPrices(mintAddresses: string[], enabled = true) {
  return useQuery({
    queryKey: ['terminal-prices', mintAddresses.join(',')],
    queryFn: async () => {
      if (mintAddresses.length === 0) return {}
      const response = await TerminalService.getTokenPrices(mintAddresses)
      return response
    },
    enabled: enabled && mintAddresses.length > 0,
    // Was 10s/10s — token prices don't move fast enough to justify that
    // cadence, and the query ran continuously while the terminal view was
    // mounted. 30s balances freshness against background request volume.
    staleTime: 30000,
    refetchInterval: 30000,
  })
}

export function useSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps = 50,
  enabled = true
) {
  return useQuery({
    queryKey: ['swap-quote', inputMint, outputMint, amount, slippageBps],
    queryFn: async () => {
      const response = await TerminalService.getSwapQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      })
      return response
    },
    enabled: enabled && !!inputMint && !!outputMint && !!amount && amount !== '0',
    staleTime: 5000, // 5 seconds for quotes
  })
}

export function useTokenSearch(query: string, limit = 10, enabled = true) {
  return useQuery({
    queryKey: ['terminal-search', query, limit],
    queryFn: async () => {
      if (!query || query.length < 2) return []
      const response = await TerminalService.searchTokens({ query, limit })
      return response
    },
    enabled: enabled && query.length >= 2,
    staleTime: 30000,
  })
}

export interface ExecuteSwapParams {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps?: number
  priorityFee?: number | "auto"
}

export function useExecuteSwap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: ExecuteSwapParams) => {
      const response = await TerminalService.executeSwap(params)
      return response
    },
    onSuccess: () => {
      // Invalidate wallet balances after successful swap
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] })
      queryClient.invalidateQueries({ queryKey: ["wallet", "tokens"] })
    },
  })
}
