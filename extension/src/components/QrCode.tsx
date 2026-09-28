import { Box } from "@mui/material"
import qrcode from "qrcode-generator"
import { useMemo } from "react"

/**
 * A REAL QR code.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * The deposit screen drew a fake one: a CSS grid with three corner squares and
 * a letter in the middle, commented "QR Code Placeholder — Simplified
 * representation". It was never scannable and never encoded anything. On a
 * screen whose entire job is to receive money, that is the worst possible
 * place for a mockup to have shipped: a reader points a phone at it, nothing
 * happens, and the only other affordance is a 44-character string they now
 * have to trust themselves to retype.
 *
 * ── THE CHOICES ─────────────────────────────────────────────────────────────
 * Error correction level H (30% recoverable) rather than M, because the mark
 * in the middle covers real modules. The mark is kept under ~14% of the
 * width and sits on a white plate: a scanner needs a clean boundary more than
 * it needs the logo to be big.
 *
 * SVG, one path, black on white — no canvas (which needs a ref, a paint tick,
 * and a devicePixelRatio dance to not look soft), no remote image service
 * (which would send the reader's deposit address to a third party to draw a
 * picture of it). It scales to any size and stays crisp.
 *
 * The quiet zone is not decoration. Scanners need clear space around the
 * symbol; without it the reader gets a QR that works on some phones.
 */
/**
 * The symbol as an SVG path, and how many modules a side.
 *
 * Pure and exported so it can be TESTED. The fake QR survived because
 * nothing ever asserted that the picture depended on the address — the whole
 * failure in one sentence.
 */
export function qrPath(value: string): { path: string; count: number } {
  // Type 0 = "pick the smallest version that fits".
  const qr = qrcode(0, "H")
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  let d = ""
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    }
  }
  return { path: d, count: n }
}

export function QrCode({
  value,
  size = 168,
  mark,
}: {
  value: string
  size?: number
  /** Optional centre mark — an <img> src. Omitted keeps the symbol pristine. */
  mark?: string
}) {
  const { path, count } = useMemo(() => qrPath(value), [value])

  const QUIET = 4 // modules, the spec's minimum
  const span = count + QUIET * 2

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "14px",
        backgroundColor: "#FFFFFF",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <Box
        component="svg"
        viewBox={`0 0 ${span} ${span}`}
        shapeRendering="crispEdges"
        sx={{ width: "100%", height: "100%", display: "block" }}
      >
        <g transform={`translate(${QUIET} ${QUIET})`}>
          <path d={path} fill="#000000" />
        </g>
      </Box>
      {mark && (
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "22%",
            height: "22%",
            borderRadius: "50%",
            backgroundColor: "#FFFFFF",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Box
            component="img"
            src={mark}
            alt=""
            sx={{ width: "76%", height: "76%", display: "block" }}
          />
        </Box>
      )}
    </Box>
  )
}
