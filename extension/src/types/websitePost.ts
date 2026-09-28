import { User } from "~/services/UserService"

export interface PostTransaction {
  token_symbol: string
  token_mint: string
  token_amount: number
  sol_amount: number
  signature: string
  token_image_url?: string
  trade_type?: "buy" | "sell"
  /**
   * READ BACK OUT OF THE LEDGER, not stored on the receipt. The API joins
   * spot_trades to this row by signature, so a receipt whose words were
   * frozen before market caps existed can still print the one the trade
   * actually happened at. Absent when the ledger has no row for this
   * signature, which is most of the back catalogue and stays honest.
   */
  mcap_usd?: number | null
  amount_usd?: number | null
}

export interface PostPrediction {
  market_title: string
  event_title?: string
  position: string
  amount: number
  signature?: string
  trade_type?: "buy" | "sell"
}

export interface WebsitePost {
  id: string
  content: string
  gifUrl?: string
  created_at: string
  updated_at: string
  upvotes: number
  downvotes: number
  user_id: string
  deleted_at: string | null
  website_url: string
  comment_count: number
  reply_count: number
  last_commented_at: string | null
  view_count: number
  only_followers: boolean
  on_chain: boolean
  user: User
  isUpvoted?: boolean
  /**
   * Quality score. 111 = legacy, -1 = awaiting scoring, 0 = heuristic-flagged
   * spam, 1-10 = scored. A row below 1 can only reach you if it is YOURS —
   * the API hides everyone else's — which is what lets the client say "only
   * you can see this" without asking who wrote it.
   */
  score?: number
  post_id?: string
  /**
   * THE FIELD THE SERVER ACTUALLY SENDS. Drizzle names the relation after
   * the table (post_transactions → post_transaction) and the finders load
   * it with `post_transaction: true`, so this is what arrives on
   * /website-post rows. `transaction` below is the name several components
   * pass it under AFTER reading it off here; both are kept because both
   * appear in live code, and only this one is the wire.
   */
  post_transaction?: PostTransaction | null
  post_prediction?: PostPrediction | null
  transaction?: PostTransaction
  prediction?: PostPrediction
}

export interface WebsitePostQueryParams {
  cursor?: string
  sort?: { field: string; order: "ASC" | "DESC" }
  search?: string
  date?: { start: Date; end: Date }
  limit?: number
  website_url?: string
  user_id?: string
  range?: "all" | "year" | "month" | "week" | "today"
  isDomainPost?: boolean
  origin?: string
  show_all_scores?: boolean
  /** Server-side trades-or-posts, decided by the RECEIPT (post_transactions
   *  row), so pages arrive full instead of being filtered after pagination. */
  kind?: "trades" | "posts"
}
