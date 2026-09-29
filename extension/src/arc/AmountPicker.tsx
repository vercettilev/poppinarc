import { Box, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { USDC_ICON_URI } from "~/assets/usdcIcon"

/**
 * HOW MUCH, AND IN WHAT: the two facts an Add money screen owes the reader
 * before it shows an address (Lev, 2026-09-29: "miktar ve birim gözükmüyor,
 * seçilebilmeli", then "25 50 100 dışında seçemiyorum").
 *
 * Any amount can be typed; $25, $50 and $100 are one tap. The unit is named,
 * with Circle's own icon, and is USDC only for now, on purpose: on Arc every
 * network fee is paid in USDC and every buy spends USDC, so a balance of EURC
 * alone could neither buy nor pay its own fee. The amount is guidance for the
 * sentence under it; the screen still notices whatever actually lands.
 */
export const AMOUNT_PICKS = [25, 50, 100] as const

/** What the field holds as a number, or null while it is not one yet. */
export function parseAmount(raw: string): number | null {
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(raw)) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Digits and one point with at most two decimals; anything else is dropped as it is typed. */
export function cleanAmountInput(raw: string): string {
  const s = raw.replace(/[^\d.]/g, "")
  const [whole = "", ...rest] = s.split(".")
  const cents = rest.join("").slice(0, 2)
  return s.includes(".") ? `${whole.slice(0, 7)}.${cents}` : whole.slice(0, 7)
}

export function AmountPicker({
  value,
  onChange,
  font = "inherit",
}: {
  value: number
  onChange: (usd: number) => void
  font?: string
}) {
  const [text, setText] = useState(String(value))
  // A pick or a parent change shows up in the field; typing is not overwritten mid-number.
  useEffect(() => {
    if (parseAmount(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          aria-label="Unit: USDC"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            height: 48,
            px: 1.25,
            borderRadius: "14px",
            flexShrink: 0,
            backgroundColor: "rgba(255,255,255,.05)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.10)",
          }}
        >
          <Box component="img" src={USDC_ICON_URI} alt="" sx={{ width: 22, height: 22, borderRadius: "50%", display: "block" }} />
          <Typography sx={{ fontFamily: font, fontSize: 14.5, fontWeight: 600, color: "#EAF2FB" }}>USDC</Typography>
        </Box>
        <Box
          component="label"
          sx={{
            flex: 1,
            minWidth: 0,
            height: 48,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1.5,
            borderRadius: "14px",
            cursor: "text",
            backgroundColor: "rgba(255,255,255,.05)",
            boxShadow: "inset 0 0 0 1px rgba(104,198,255,.28)",
            "&:focus-within": { boxShadow: "inset 0 0 0 1.5px #68C6FF" },
          }}
        >
          <Typography component="span" sx={{ fontFamily: font, fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,.55)" }}>
            $
          </Typography>
          <Box
            component="input"
            type="text"
            inputMode="decimal"
            aria-label="Amount in dollars"
            value={text}
            onChange={(e) => {
              const next = cleanAmountInput((e.target as HTMLInputElement).value)
              setText(next)
              const n = parseAmount(next)
              if (n !== null) onChange(n)
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "#FFFFFF",
              fontFamily: font,
              fontSize: 18,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </Box>
      </Box>
      <Box role="radiogroup" aria-label="Quick amounts" sx={{ display: "grid", gridTemplateColumns: `repeat(${AMOUNT_PICKS.length}, 1fr)`, gap: 1 }}>
        {AMOUNT_PICKS.map((usd) => {
          const on = usd === value
          return (
            <Box
              key={usd}
              component="button"
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setText(String(usd))
                onChange(usd)
              }}
              sx={{
                height: 38,
                border: 0,
                borderRadius: "12px",
                cursor: "pointer",
                fontFamily: font,
                fontSize: 14,
                fontWeight: 700,
                color: on ? "#06202E" : "rgba(255,255,255,.85)",
                backgroundColor: on ? "#68C6FF" : "rgba(255,255,255,.05)",
                boxShadow: on ? "0 6px 20px -8px rgba(104,198,255,.6)" : "inset 0 0 0 1px rgba(255,255,255,.10)",
                transition: "background-color .15s ease-out",
                "&:hover": { backgroundColor: on ? "#8AD4FF" : "rgba(255,255,255,.09)" },
              }}
            >
              {`$${usd}`}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
