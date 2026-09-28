import { sendApiRequest } from "~/lib/fetchService"

export interface DittoSummary {
  balance: number
  dailyEarnRemaining: number
  dailyEarnCap: number
  dittoPerUsd: number
  winMultiplier: number
}

export interface DittoPredictionStats {
  totalDitto: number
  totalUsdVolume: number
  tradeCount: number
}

/**
 * Read endpoints for the ditto ledger. Writes (awards, spends) live inside
 * the trade flows on the backend; nothing here mutates state.
 */
export class DittoService {
  static async getSummary() {
    return sendApiRequest<DittoSummary>({
      url: "/ditto/summary",
      method: "GET",
    })
  }
}
