import { Box, Typography } from "@mui/material"
import { USDC_ICON_URI } from "~/assets/usdcIcon"

/**
 * HOW MUCH, AND IN WHAT: the two facts an Add money screen owes the reader
 * before it shows an address (Lev, 2026-09-29: "miktar ve birim gözükmüyor,
 * seçilebilmeli").
 *
 * The amount is picked; the unit is named, with Circle's own icon. The unit
 * is USDC and only USDC for now, on purpose: on Arc every network fee is paid
 * in USDC and every buy spends USDC, so a balance of EURC alone could neither
 * buy nor pay its own fee. The picked amount is guidance for the sentence
 * under it; the screen still notices whatever actually lands.
 */
export const AMOUNT_PICKS = [25, 50, 100] as const

export function AmountPicker({
  value,
  onChange,
  font = "inherit",
}: {
  value: number
  onChange: (usd: number) => void
  font?: string
}) {
  return (
    <Box sx={{ width: "100%", display: "flex", alignItems: "center", gap: 1 }}>
      <Box
        aria-label="Unit: USDC"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          height: 40,
          px: 1.25,
          borderRadius: "12px",
          flexShrink: 0,
          backgroundColor: "rgba(255,255,255,.05)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.10)",
        }}
      >
        <Box component="img" src={USDC_ICON_URI} alt="" sx={{ width: 20, height: 20, borderRadius: "50%", display: "block" }} />
        <Typography sx={{ fontFamily: font, fontSize: 14, fontWeight: 600, color: "#EAF2FB" }}>USDC</Typography>
      </Box>
      <Box role="radiogroup" aria-label="Amount" sx={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${AMOUNT_PICKS.length}, 1fr)`, gap: 1 }}>
        {AMOUNT_PICKS.map((usd) => {
          const on = usd === value
          return (
            <Box
              key={usd}
              component="button"
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(usd)}
              sx={{
                height: 40,
                border: 0,
                borderRadius: "12px",
                cursor: "pointer",
                fontFamily: font,
                fontSize: 14.5,
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
