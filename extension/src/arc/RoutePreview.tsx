import { Box, CircularProgress, Typography } from "@mui/material"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { JUICE } from "~/theme/juice"
import { sendApiRequest } from "~/lib/fetchService"
import { AmountPicker } from "./AmountPicker"

/**
 * THE ROUTE FROM THE READER'S ARC BALANCE TO AN ASSET ON ANOTHER CHAIN.
 *
 * Arc is where the money lives; an asset on Solana, Hyperliquid, Base or
 * Ethereum is reached by moving that USDC over CCTP and swapping it on the
 * asset's home venue (arc-api routes/route-quotes.ts). Every number here is
 * live from the party that runs that leg. Sending it needs a wallet on each
 * chain, which Circle Wallets gives every account, so the room says plainly
 * that the trade opens then, and spends nothing now.
 */
export interface RoutePreviewAnswer {
  asset: { key: string; ticker: string; name: string; chain: string }
  amountUsd: number
  legs: Array<{ kind: "bridge" | "swap"; label: string; detail: string; feeUsd: number | null }>
  outAmount: number
  outUsd: number | null
  priceUsd: number
  cctpFeeUsd: number
  networkFeeUsd: number | null
  priceImpactPct: number | null
  available: boolean
  note: string
}

/** "0.2105", "31.02", "1,204": enough digits to read, never a wall of them. */
export function units(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 })
  const digits = Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(n)) + 2))
  return n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")
}

export function fee(n: number | null): string {
  if (n === null) return ""
  if (n === 0) return "free"
  return n < 0.01 ? "under 1¢" : `$${n.toFixed(2)}`
}

export function RoutePreview({ mint }: { mint: string }) {
  const [amount, setAmount] = useState(25)
  const q = useQuery({
    queryKey: ["arc", "route", mint, amount],
    queryFn: () =>
      sendApiRequest<RoutePreviewAnswer>({
        url: "/embed/asset/route",
        method: "POST",
        data: { mint, amountUsd: amount },
        apiType: "backend",
      }),
    staleTime: 15_000,
    retry: 1,
  })
  const r = q.data

  return (
    <Box sx={{ mb: 2, p: 1.75, borderRadius: "16px", backgroundColor: JUICE.well, border: `1px solid ${JUICE.border}` }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700, mb: 1.25 }}>From your Arc balance</Typography>
      <AmountPicker value={amount} onChange={setAmount} />

      {q.isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2.5 }}>
          <CircularProgress size={18} sx={{ color: JUICE.accent }} />
        </Box>
      )}
      {q.isError && (
        <Typography sx={{ fontSize: 12.5, color: JUICE.text2, mt: 1.5 }}>
          This route cannot be priced right now. Try again in a moment.
        </Typography>
      )}

      {r && (
        <>
          <Box sx={{ mt: 1.75, display: "grid", gap: 1 }}>
            {r.legs.map((leg, i) => (
              <Box key={leg.label} sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: JUICE.accent,
                    backgroundColor: "rgba(104,198,255,.14)",
                  }}
                >
                  {i + 1}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{leg.label}</Typography>
                    <Typography sx={{ fontSize: 12, color: JUICE.text2, whiteSpace: "nowrap" }}>{fee(leg.feeUsd)}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 11.5, color: JUICE.text3, lineHeight: 1.45 }}>{leg.detail}</Typography>
                </Box>
              </Box>
            ))}
          </Box>

          <Box sx={{ mt: 1.75, pt: 1.5, borderTop: `1px solid ${JUICE.border}` }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
              {`About ${units(r.outAmount)} ${r.asset.ticker}`}
            </Typography>
            <Typography sx={{ fontSize: 12, color: JUICE.text2, mt: 0.25 }}>
              {`${r.asset.name} on ${r.asset.chain}, at $${units(r.priceUsd)} each`}
              {r.priceImpactPct !== null && r.priceImpactPct > 0.1 ? `, ${r.priceImpactPct.toFixed(2)}% price impact` : ""}
            </Typography>
          </Box>

          <Box
            component="button"
            type="button"
            disabled
            sx={{
              mt: 1.75,
              width: "100%",
              height: 42,
              border: 0,
              borderRadius: "999px",
              font: "inherit",
              fontSize: 13.5,
              fontWeight: 700,
              color: JUICE.text2,
              backgroundColor: "rgba(255,255,255,.06)",
              cursor: "default",
            }}
          >
            {`Buy on ${r.asset.chain} · soon`}
          </Box>
          <Typography sx={{ fontSize: 11.5, color: JUICE.text3, mt: 1, lineHeight: 1.5, textAlign: "center" }}>
            {r.note}
          </Typography>
        </>
      )}
    </Box>
  )
}
