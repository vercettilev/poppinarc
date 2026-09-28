/**
 * The three classification types the spot engine needs.
 *
 * Deliberately NOT the whole poppin-v2 event union: the event schema belongs
 * with the sink that writes it (apps/backend), and a framework-free engine
 * package has no business knowing what a `page_scanned` row looks like. What
 * it does need is the vocabulary for saying WHICH KIND of asset it just
 * admitted, because that is a property of the routing decision itself.
 */

export type Journey = 'A' | 'B';
export type Chain = 'solana' | 'arc';

/**
 * The funnel split. `equity` is the curated regime (a catalog row, issuer
 * named, §7's gate not consulted); `token` is whatever the open-mint gate
 * admitted. They are read as separate funnels, never averaged — the paths
 * differ in resolution route, safety rules and liquidity, so a blended rate
 * moves when the MIX moves and looks like a product change.
 *
 * `memecoin` / `spot` / `commodity` are finer distinctions inside the open
 * regime that nothing sets yet.
 */
export type AssetCategory =
  | 'memecoin'
  | 'spot'
  | 'equity'
  | 'commodity'
  | 'token'
  | 'unknown';
