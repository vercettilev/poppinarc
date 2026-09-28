import { ARC_EDITION } from "~/config/edition"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  AirdropParams,
  SignMessageParams,
  TransferSOLParams,
  TransferTokenParams,
  WalletService,
} from "~/services/WalletService"

/**
 * Hook to get current user's wallet information
 */
export function useMyWallet() {
  return useQuery({
    queryKey: ["wallet", "me"],
    queryFn: () => WalletService.getMyWallet(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Mutation to provision missing wallets for the current user.
 * Used by the empty-wallet screen's Retry button — backstops users
 * whose registration didn't run the wallet-creation step.
 */
export function useProvisionWallets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => WalletService.provisionWallets(),
    onSuccess: () => {
      // Force every wallet-related query to refetch so the UI flips
      // off the empty-state and starts loading balances.
      queryClient.invalidateQueries({ queryKey: ["wallet"] })
    },
  })
}

/**
 * Hook to get wallet balance
 */
export function useWalletBalance(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => WalletService.getBalance(),
    refetchInterval: 30000, // Refetch every 30 seconds
    enabled: opts.enabled !== false,
  })
}

/**
 * Hook to get wallet tokens
 */
export function useWalletTokens(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["wallet", "tokens"],
    queryFn: () => WalletService.getTokens(),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: opts.enabled !== false,
  })
}

/**
 * Hook to get transaction history (DB-backed, includes both on-chain
 * Solana txs the indexer caught and locally-recorded actions like swaps).
 * Gate via `enabled` to avoid firing this where the
 * deposit-wallet history comes from a different endpoint).
 */
export function useWalletTransactions(
  limit: number = 50,
  offset: number = 0,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["wallet", "transactions", limit, offset],
    queryFn: () => WalletService.getTransactions(limit, offset),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: opts.enabled !== false,
  })
}

/**
 * Hook to transfer SOL
 */
export function useTransferSOL() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: TransferSOLParams) => WalletService.transferSOL(params),
    onSuccess: () => {
      // Invalidate balance and transactions queries
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] })
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] })
    },
  })
}

/**
 * Hook to transfer SPL token
 */
export function useTransferToken() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: TransferTokenParams) =>
      WalletService.transferToken(params),
    onSuccess: () => {
      // Invalidate tokens, balance, and transactions queries
      queryClient.invalidateQueries({ queryKey: ["wallet", "tokens"] })
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] })
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] })
    },
  })
}

/**
 * Hook to sign a message
 */
export function useSignMessage() {
  return useMutation({
    mutationFn: (params: SignMessageParams) =>
      WalletService.signMessage(params),
  })
}

/**
 * Hook to request airdrop (devnet/testnet only)
 */
export function useRequestAirdrop() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: AirdropParams) => WalletService.requestAirdrop(params),
    onSuccess: () => {
      // Invalidate balance and transactions queries after airdrop
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] })
        queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] })
      }, 5000) // Wait 5 seconds for blockchain confirmation
    },
  })
}

/**
 * Interface for SOL price data from CoinGecko
 */
interface SOLPriceData {
  usd: number
  usd_24h_change: number
}

/**
 * Hook to get real-time SOL price and 24h change from CoinGecko API
 */
export function useSOLPrice() {
  return useQuery({
    queryKey: ["solana", "price"],
    queryFn: async () => {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true"
      )

      if (!response.ok) {
        throw new Error("Failed to fetch SOL price")
      }

      const data = await response.json()

      return {
        usd: data.solana.usd,
        usd_24h_change: data.solana.usd_24h_change,
      } as SOLPriceData
    },
    staleTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 1 * 60 * 1000, // Refetch every 1 minute
    retry: 3,
    // The Arc edition holds no SOL; a CoinGecko poll a minute would buy nothing.
    enabled: !ARC_EDITION,
  })
}

/**
 * Hook to get token prices for multiple tokens from backend
 * @param mintAddresses Array of token mint addresses
 */
export function useTokenPrices(mintAddresses: string[]) {
  return useQuery({
    queryKey: ["token-prices", mintAddresses],
    queryFn: async () => {
      const response = await WalletService.getTokenPrices(mintAddresses)
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    enabled: mintAddresses.length > 0, // Only fetch if we have addresses
    retry: 3,
  })
}

/**
 * Hook to get list of user IDs who have tipped on a specific post
 * Used for displaying "tipper badge" on comments
 * @param postId Post ID
 */
export function useTippersForPost(postId: string | undefined) {
  return useQuery({
    queryKey: ["tippers", postId],
    queryFn: async () => {
      if (!postId) return { tipperIds: [] }
      const response = await WalletService.getTippersForPost(postId)
      return response
    },
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: !!postId, // Only fetch if we have a postId
  })
}
