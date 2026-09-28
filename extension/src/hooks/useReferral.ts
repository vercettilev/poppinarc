import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ReferralService,
  ReferralCode,
  ReferralStats,
  ReferralEarning,
} from "~/services/ReferralService"

const MY_CODE_KEY = ["referrals", "my-code"]
const STATS_KEY = ["referrals", "stats"]
const EARNINGS_KEY = ["referrals", "earnings"]

/**
 * Current user's referral code. Backend generates one lazily on first call
 * so this is effectively "always succeeds" for any logged-in user.
 */
export function useMyReferralCode(enabled: boolean = true) {
  return useQuery<ReferralCode>({
    queryKey: MY_CODE_KEY,
    queryFn: () => ReferralService.getMyCode(),
    staleTime: 5 * 60 * 1000, // code never changes once set
    enabled,
  })
}

/**
 * Aggregate stats — total earned, pending, paid, count of referrals.
 * Polls on window focus since a trade from a referred user can bump this
 * without user action.
 */
export function useReferralStats(enabled: boolean = true) {
  return useQuery<ReferralStats>({
    queryKey: STATS_KEY,
    queryFn: () => ReferralService.getStats(),
    staleTime: 30 * 1000,
    enabled,
  })
}

/**
 * Paginated earnings ledger. Default page size 20.
 */
export function useReferralEarnings(
  params: { limit?: number; offset?: number } = {},
  enabled: boolean = true,
) {
  return useQuery<{ items: ReferralEarning[] }>({
    queryKey: [...EARNINGS_KEY, params.limit ?? 20, params.offset ?? 0],
    queryFn: () => ReferralService.getEarnings(params),
    staleTime: 30 * 1000,
    enabled,
  })
}

/**
 * Apply a referral code during onboarding. One-shot mutation — the backend
 * will reject subsequent calls once `referred_by_user_id` is set.
 */
export function useApplyReferralCode() {
  const queryClient = useQueryClient()
  return useMutation<
    { referrerId: string },
    { message?: string; status?: number },
    string
  >({
    mutationFn: (code: string) => ReferralService.applyCode(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-user"] })
    },
  })
}
