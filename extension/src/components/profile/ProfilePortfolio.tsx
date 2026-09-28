import { JUICE } from "~/theme/juice"
import { alpha, Box, Typography } from "@mui/material"
import { readBookCache, writeBookCache } from "~/helpers/bookCache"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import {
  positionsAsset,
  type SpotPosition,
  type SpotPositionsResponse,
} from "~/services/SpotAssetService"
import { portfolioTotalUsd } from "~/helpers/portfolioTotal"
import { openPnl, pnlCaption } from "~/helpers/openPnl"
import { qtyText } from "~/helpers/qtyText"
import {
  ACCENT,
  DIM,
  FAINT,
  GREEN,
  PANEL_CARD,
  PANEL_ROW,
  RED,
  signedUsd,
  usd,
} from "~/helpers/panelSurface"

/**
 * The money answer, first — on your own profile only.
 *
 * The page card's "me" view settled this order (portfolio, then activity) and
 * the profile is the same question asked with more room. A portfolio is
 * private and the endpoint is authenticated, so this block exists for exactly
 * one reader: the one it belongs to.
 *
 * ── THE HONESTY RULE, INHERITED ─────────────────────────────────────────────
 * `totalPnlUsd` is null when even one holding predates the ledger and has no
 * computable basis. Null is not zero and it is not "flat" — a book that
 * cannot be scored says so instead of printing a confident number over a
 * guess. Same rule the card prints, same words.
 *
 * ── WHY IT HOLDS ITS SPACE ──────────────────────────────────────────────────
 * Three states, like the page's trade card: asking → a skeleton the feed
 * starts below; nothing to show (signed out, empty book, unreachable) →
 * nothing at all; an answer → drawn into the space already held. A block that
 * appears late shoves the feed down, and that was the exact complaint on the
 * page card an hour ago.
 */

const TOP_N = 3

export function ProfilePortfolio() {
  const navigate = useNavigate()
  /** undefined = asking · null = nothing to show. */
  const [book, setBook] = useState<SpotPositionsResponse | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    // Yesterday's book NOW, today's the moment it lands — the background's
    // watch keeps this cache at most two minutes old in normal use, so the
    // 8.6s cold open becomes a paint. Display only; trade sheets stay live.
    let settled = false
    void readBookCache().then((cached) => {
      if (alive && !settled && cached) setBook(cached)
    })
    positionsAsset()
      .then((r) => {
        // An EMPTY book is still an answer. Hiding the block on empty made a
        // fresh account's profile read as a dead page with four zeros; the
        // money block is exactly where a new reader learns what this app is.
        settled = true
        if (alive) setBook(r)
        void writeBookCache(r)
      })
      .catch(() => {
        // Signed out, or the book could not be read. Either way there is
        // nothing truthful to draw, and an error box on a profile is noise.
        if (alive) setBook(null)
      })
    return () => {
      alive = false
    }
  }, [])

  if (book === undefined) return <PortfolioSkeleton />
  if (!book) return null

  // A book with no positions leads with the cash and the one next step,
  // instead of three empty rows pretending to be a portfolio.
  if (!book.positions.length) {
    return (
      <Box sx={{ mx: 2, mt: 1.5, ...PANEL_CARD }}>
        <Typography
          sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: DIM }}
        >
          PORTFOLIO
        </Typography>
        <Typography
          sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", mt: 0.5 }}
        >
          {usd(book.cashUsd)}
        </Typography>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: FAINT, mt: "1px" }}>
          Cash, ready to trade
        </Typography>
        <Box
          component="button"
          onClick={() => navigate("/receive")}
          className="click-animation"
          sx={{
            mt: 1.25,
            width: "100%",
            border: "none",
            cursor: "pointer",
            font: "inherit",
            fontSize: 13,
            fontWeight: 700,
            py: "10px",
            borderRadius: "999px",
            color: JUICE.onAccent,
            backgroundColor: ACCENT,
            boxShadow: "0 8px 26px -8px rgba(104,198,255,.55)",
            "&:hover": { backgroundColor: "#86D2FF" },
          }}
        >
          Deposit USDC
        </Box>
        <Typography
          sx={{ fontSize: 11, color: FAINT, mt: 1, textAlign: "center", lineHeight: 1.5 }}
        >
          Buy from the chip under any tweet. It lands here.
        </Typography>
      </Box>
    )
  }

  /**
   * A ROW THAT SAYS $0.00 IS NOT A HOLDING, IT IS ARITHMETIC.
   *
   * Three of them were on screen at once (screenshot, 2026-09-20): "NVDAx
   * $0.00 / -0.7%", "WIF $0.00 / -4.7%", "RAY $0.00 / -12.3%". Each is a
   * real position worth a fraction of a cent, drawn as a line saying the
   * reader owns nothing and that nothing moved. The chip's own book made
   * this call already and counts them in a sentence instead.
   *
   * MIRRORED from the You room's DUST_USD (entries/contentScript/x/
   * xStrip.ts); profile-book.spec.ts reads that file and fails if the two
   * numbers drift, because a holding that is a row on one surface and a
   * tally on the other is two products.
   */
  const DUST_USD = 0.01
  const dust = book.positions.filter(
    (p) => p.valueUsd !== null && p.valueUsd < DUST_USD,
  ).length
  const rows = [...book.positions]
    .filter((p) => p.valueUsd === null || p.valueUsd >= DUST_USD)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, TOP_N)
  /** Held positions the price lookup could not answer for, this refresh. */
  const unpriced = book.positions.filter((p) => p.valueUsd === null).length
  const allUnpriced = book.positions.length > 0 && unpriced === book.positions.length

  /**
   * WHAT YOU HAVE, WHICH INCLUDES THE MONEY.
   *
   * This read book.totalUsd — the tokens alone. Reported from the field
   * with a screenshot: a reader holding $493.95 of USDC and $1.73 of WIF
   * saw "$1.73" in 26px type under the word PORTFOLIO, with the cash a
   * grey caption below it. A total that leaves out the largest component
   * is not a total, and on a product whose whole thesis is that USDC IS
   * the money, that reads as "your money is gone".
   *
   * The old "—" rule survives but narrows. A book whose every position
   * went unpriced is not worth $0.00, it is worth "we could not look" —
   * still true. But it is only UNKNOWN when there is no cash either: with
   * $493.95 sitting there we know a floor, and printing a dash over a
   * balance we can read is the same lie in the other direction.
   */
  const heroUsd =
    allUnpriced && book.cashUsd <= 0 ? null : portfolioTotalUsd(book)

  /**
   * THE OPEN BOOK, NOT THE WHOLE HISTORY.
   *
   * This read totalPnlUsd, which folds realized into unrealized and so
   * keeps counting money the reader already took out. On a $3.55 book that
   * printed an unlabelled red "−$1,276.44" (screenshot, 2026-09-20) beside
   * a line this same card writes as "−$1.25 banked" — two numbers about
   * the same reader, three orders of magnitude apart, in one card.
   *
   * The chip and the front door both fixed this months ago and this
   * surface was missed. helpers/openPnl.ts now holds the preference so
   * there is no third place to miss.
   */
  const open = openPnl(book)
  const pnl = open?.usd ?? null
  const up = (pnl ?? 0) >= 0

  return (
    <Box sx={{ mx: 2, mt: 1.5, ...PANEL_CARD }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography
          sx={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: DIM }}
        >
          PORTFOLIO
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          onClick={() => navigate("/")}
          className="click-animation"
          sx={{
            background: "none",
            border: "none",
            p: 0,
            cursor: "pointer",
            font: "inherit",
            fontSize: 11.5,
            fontWeight: 700,
            color: ACCENT,
          }}
        >
          All {book.positions.length} →
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, mt: 0.5 }}>
        <Typography
          sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
        >
          {/* A book whose every position went unpriced is NOT worth $0.00 —
              it is worth "we could not look just now", and only one of those
              sentences is ever true by accident. Reported from the field:
              PORTFOLIO $0.00 over a WIF row reading "—", while the panel
              priced the same position at $1.61 in the same minute. */}
          {heroUsd === null ? "—" : usd(heroUsd)}
        </Typography>
        {pnl !== null && (
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: up ? GREEN : RED,
              backgroundColor: up ? alpha(GREEN, 0.12) : alpha(RED, 0.12),
              borderRadius: "999px",
              px: 0.85,
              py: "2px",
              mb: "3px",
            }}
          >
            {signedUsd(pnl)}
          </Typography>
        )}
        {/* NAME WHICH P&L IT IS. An unlabelled figure beside a portfolio
            value reads as "today", and the all-time fallback is not. The
            front door spells it out the same way one screen over. */}
        {pnl !== null && (
          <Typography
            sx={{ fontSize: 10.5, fontWeight: 600, color: FAINT, mb: "4px" }}
          >
            {pnlCaption(open)}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: FAINT, mt: "1px" }}>
        {/* Still said, because the split between spendable and held is a
            real question — it just no longer has to carry the whole
            answer on its own. */}
        {usd(book.cashUsd)} cash
        {/* The banked figure is the part no candle can take back — said in
            the same breath as cash because both are already real dollars.
            Hidden at null or dust: a zero would claim "you banked nothing"
            about ledgers that predate quantities. */}
        {typeof book.totalRealizedPnlUsd === "number" &&
          Math.abs(book.totalRealizedPnlUsd) >= 0.005 &&
          ` · ${signedUsd(book.totalRealizedPnlUsd)} banked`}
        {/* Value trouble subsumes P&L trouble: no value, no P&L either, and
            two notes about one outage is one note too many. */}
        {/* The folded rows, named rather than disappeared — the same rule
            the You room's "+ N under $0.01" line follows. */}
        {dust > 0 && ` · ${dust} under ${usd(DUST_USD)}`}
        {unpriced > 0
          ? " · value unavailable for part of this book"
          : pnl === null && " · P&L unavailable for part of this book"}
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1.25 }}>
        {/*
          CASH LEADS, AS A HOLDING. The list showed three memecoins and no
          USDC, so the one asset a reader actually spends was the only one
          missing from a list of what they own — the same shape the wallet
          screen was corrected for, and for the same reason: this is a
          wallet app, and wallet apps put the money first.

          Not a SpotPosition, so not a Holding: it has no mint to price, no
          24h move to colour, and inventing either to reuse the component
          would be dressing cash as a trade.
        */}
        {book.cashUsd > 0 && <CashRow usd={book.cashUsd} onOpen={() => navigate("/receive")} />}
        {rows.map((p) => (
          /* THE ROW KNOWS WHICH MINT IT IS, so it opens that mint. Every
             row was a per-asset button that threw its asset away and
             landed on the undifferentiated book — the same door the "All
             N →" link above already is. The chip's own book has opened
             /token/<mint> from a row for months. */
          <Holding key={p.mint} p={p} onOpen={() => navigate(`/token/${p.mint}`)} />
        ))}
      </Box>
    </Box>
  )
}

/**
 * The money, dressed as what it is. Same row shape as a holding so the eye
 * reads one list, but no change badge and no chart door: cash does not
 * move against itself, and pressing it goes where more cash comes from.
 */
function CashRow({ usd: amount, onOpen }: { usd: number; onOpen: () => void }) {
  return (
    <Box
      component="button"
      onClick={onOpen}
      className="click-animation"
      sx={{
        ...PANEL_ROW,
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        px: 1,
        py: "8px",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        color: "#FFFFFF",
        "&:hover": { backgroundColor: alpha("#FFFFFF", 0.06) },
      }}
    >
      <Box
        sx={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 800,
          color: JUICE.onAccent,
          background: `linear-gradient(140deg, #3AA6FF, #1D6FD0)`,
        }}
      >
        $
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
          USDC
        </Typography>
        <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: FAINT }}>
          Cash, ready to spend
        </Typography>
      </Box>
      <Typography
        sx={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
      >
        {usd(amount)}
      </Typography>
    </Box>
  )
}

function Holding({ p, onOpen }: { p: SpotPosition; onOpen: () => void }) {
  const ch = p.change24hPct
  const up = (ch ?? 0) >= 0
  const ticker = p.ticker.replace(/^\$/, "")
  return (
    <Box
      component="button"
      onClick={onOpen}
      className="click-animation"
      sx={{
        ...PANEL_ROW,
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        px: 1,
        py: "8px",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        color: "#FFFFFF",
        "&:hover": { backgroundColor: alpha("#FFFFFF", 0.06) },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: 26,
          height: 26,
          borderRadius: "50%",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "#9FD9FF",
          backgroundColor: alpha(ACCENT, 0.16),
          overflow: "hidden",
        }}
      >
        {ticker.charAt(0)}
        {/* The coin's own face over the letter, by the same ours-origin
            road the feed receipts ride; a mint with no art anywhere errors
            out and the letter is what remains - the honest end. */}
        <Box
          component="img"
          src={`${process.env.NEXT_PUBLIC_API_URL}/embed/asset/icon?mint=${p.mint}`}
          alt=""
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = "none"
          }}
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
          {ticker}
        </Typography>
        <Typography
          sx={{
            fontSize: 10.5,
            fontWeight: 600,
            color: FAINT,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {/* qtyText, not four fraction digits. helpers/qtyText.ts exists
              because that formatting prints any quantity under 0.00005 as
              "0" — it turned a real $1.00 purchase into "0 WBTC" once, and
              it was still doing it here: a live screenshot shows this row
              reading "0 NVDAx" for a position the reader holds. One rule,
              in one place, and this was the last surface outside it. */}
          {qtyText(p.uiAmount)} {ticker}
        </Typography>
      </Box>
      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
        <Typography
          sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}
        >
          {p.valueUsd === null ? "—" : usd(p.valueUsd)}
        </Typography>
        {ch !== null && (
          <Typography
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: up ? GREEN : RED,
            }}
          >
            {up ? "+" : ""}
            {ch.toFixed(1)}%
          </Typography>
        )}
      </Box>
    </Box>
  )
}

const BLOCK = { backgroundColor: "rgba(255,255,255,.07)", borderRadius: "6px" }

/** The block's shape while /positions answers — which was measured at 8.6s
 *  cold, so this is not a formality. */
function PortfolioSkeleton() {
  return (
    <Box
      aria-hidden
      sx={{
        mx: 2,
        mt: 1.5,
        ...PANEL_CARD,
        animation: "poppinProfileBreathe 1.6s ease-in-out infinite",
        "@keyframes poppinProfileBreathe": {
          "0%, 100%": { opacity: 0.5 },
          "50%": { opacity: 0.85 },
        },
      }}
    >
      <Box sx={{ ...BLOCK, width: 74, height: 11 }} />
      <Box sx={{ ...BLOCK, width: 132, height: 29, mt: 1 }} />
      <Box sx={{ ...BLOCK, width: 96, height: 12, mt: "5px" }} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1.25 }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ ...PANEL_ROW, ...BLOCK, height: 42 }} />
        ))}
      </Box>
    </Box>
  )
}
