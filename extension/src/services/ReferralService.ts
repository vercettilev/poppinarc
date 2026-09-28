import { sendApiRequest } from "~/lib/fetchService"

export interface ReferralCode {
  code: string
}

export interface ReferralStats {
  code: string
  referrals_count: number
  total_earned_usd: string
  pending_usd: string
  paid_usd: string
  failed_usd: string
}

export interface ReferralEarning {
  id: string
  referrer_user_id: string
  referred_user_id: string
  /**
   * Mirrors the backend's ReferralSourcePlatform, which mirrors the
   * `referral_earning_platform` DB enum. dflow_buy/dflow_sell were missing
   * here, so a real row could arrive as a value this type says is
   * impossible. The prediction-era names stay because the ENUM still has
   * them and old rows still carry them — dropping them from the type would
   * only hide history, and dropping them from the enum is a migration.
   * Not rendered to anyone any more; see referral-program.tsx.
   */
  source_platform:
    | "polymarket_buy"
    | "polymarket_sell"
    | "jupiter"
    | "kalshi"
    | "dflow_buy"
    | "dflow_sell"
  source_order_id: string
  fee_amount_usd: string
  earning_amount_usd: string
  status: "pending" | "paid" | "failed"
  payout_tx_hash: string | null
  paid_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export class ReferralService {
  static async getMyCode() {
    return sendApiRequest<ReferralCode>({
      url: "/referrals/my-code",
      method: "GET",
    })
  }

  static async getStats() {
    return sendApiRequest<ReferralStats>({
      url: "/referrals/stats",
      method: "GET",
    })
  }

  static async getEarnings(params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams()
    if (params.limit) query.append("limit", String(params.limit))
    if (params.offset) query.append("offset", String(params.offset))
    const q = query.toString()
    return sendApiRequest<{ items: ReferralEarning[] }>({
      url: `/referrals/earnings${q ? `?${q}` : ""}`,
      method: "GET",
    })
  }

  static async applyCode(code: string) {
    return sendApiRequest<{ referrerId: string }>({
      url: "/referrals/apply",
      method: "POST",
      data: { code },
    })
  }
}
