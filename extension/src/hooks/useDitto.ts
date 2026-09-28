import { useQuery } from "@tanstack/react-query"
import { DittoService } from "~/services/DittoService"

/**
 * Aggregate trade-derived ditto + USDC volume for the current user. Powers
 * the "Prediction Trader" stat card on the tasks page. The trade flows
 * (`usePolymarketBuy/Sell/Redeem`) invalidate `["ditto-summary"]` already;
 * we share the prefix so a fresh stat-card number lands without an extra
 * invalidate call site.
 */
