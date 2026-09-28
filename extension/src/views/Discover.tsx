import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import { alpha, Box, InputBase, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { useInfiniteTerminalTokens } from "~/hooks/useTerminalTokens"
import { ACCENT, DIM, GREEN, PANEL_PILL, RED } from "~/helpers/panelSurface"
import { compactMoney } from "~/helpers/safetyLine"
import { priceText } from "~/helpers/priceText"
import { JUICE } from "~/theme/juice"
import type { TokenCategory } from "~/services/TerminalService"

/**
 * DISCOVER — /discover. The terminal, reborn in the panel's own language.
 *
 * A full terminal view (src/views/terminal.tsx) shipped, was imported,
 * and was never routed — a thousand lines of working data plumbing behind
 * a door that did not exist. What comes back is the PLUMBING, not the
 * room: the old view's cards carried a quick-buy in SOL lamports through
 * the retired swap rail, and re-opening that door would resurrect a money
 * path the product deliberately killed (USDC is the money).
 *
 * So every row here is a DOOR, not a trade: it opens /token/:mint, where
 * the by-mint gate decides live whether this token can be described and
 * the one real trade sheet does the money. Discovery lists; the room
 * gates. A token this list shows and the gate refuses is refused with the
 * gate's own words, exactly like a cashtag on X.
 *
 * SCOPE NOTE: this deliberately does NOT breach the "no trending lists"
 * cut in SCOPE.md by accident — it retires that cut on the owner's
 * explicit roadmap call (item 9, approved 2026-08-30). The SCOPE row for
 * this feature updates the cut in the same commit.
 */

const CATEGORIES: Array<{ key: TokenCategory; word: string }> = [
  { key: "toptrending", word: "Trending" },
  { key: "toptraded", word: "Most traded" },
  { key: "recent", word: "New" },
  // Jupiter's internal name is "organic score"; a browse chip speaks the
  // reader's language, not the vendor's - and the score itself is volatile
  // (measured), so it browses rather than certifies.
  { key: "toporganicscore", word: "Community" },
]

const num = (s?: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function Discover() {
  const navigate = useNavigate()
  const [category, setCategory] = useState<TokenCategory>("toptrending")
  const [search, setSearch] = useState("")
  // The QUERY trails the typing by a beat: each search bypasses the
  // backend token cache and fans out to Jupiter on the paid key, and a
  // request per keystroke is a bill for letters nobody finished typing.
  const [query, setQuery] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])
  const { data, isLoading, isFetching, isError, refetch } = useInfiniteTerminalTokens({
    category,
    limit: 20,
    search: query || undefined,
  })

  // Deduped by address DEFENSIVELY: an older server still claims a next
  // page exists (its fetchers only ever knew `limit`, so every page was
  // the same top-N), and appending duplicates breaks React keys before
  // it confuses anybody's eyes.
  const seen = new Set<string>()
  const tokens = (data?.pages.flatMap((p) => p.tokens ?? []) ?? []).filter(
    (t) => !seen.has(t.address) && (seen.add(t.address), true),
  )

  return (
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto", boxSizing: "border-box" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.5 }}>
        <Box
          component="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Back"
          className="click-animation"
          sx={{
            ...PANEL_PILL, width: 32, height: 32, display: "grid", placeItems: "center",
            cursor: "pointer", color: "#FFFFFF", p: 0, flexShrink: 0,
            "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>Discover</Typography>
        <Box sx={{ flex: 1 }} />
        {/* What's moving, and WHO moves it — the caller board is Discover's
            sibling, one tap away. */}
        <Box
          component="button"
          onClick={() => navigate("/callers")}
          className="click-animation"
          sx={{
            ...PANEL_PILL, px: 1.25, py: "5px", cursor: "pointer",
            font: "inherit", fontSize: 11.5, fontWeight: 700, color: ACCENT,
            flexShrink: 0,
          }}
        >
          Top callers
        </Box>
      </Box>

      <InputBase
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tokens"
        sx={{
          ...PANEL_PILL, width: "100%", px: 1.5, py: "6px", mb: 1.25,
          fontSize: 13, color: "#FFFFFF",
          "& input::placeholder": { color: DIM, opacity: 1 },
        }}
      />

      <Box sx={{ display: "flex", gap: 0.5, mb: 1.5, flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => (
          <Box
            key={c.key}
            component="button"
            onClick={() => setCategory(c.key)}
            className="click-animation"
            sx={{
              ...PANEL_PILL, px: 1.25, py: "5px", cursor: "pointer", font: "inherit",
              fontSize: 11.5, fontWeight: 700,
              color: category === c.key ? JUICE.onAccent : DIM,
              backgroundColor: category === c.key ? ACCENT : "rgba(255,255,255,.06)",
            }}
          >
            {c.word}
          </Box>
        ))}
      </Box>

      {/* THE FIRST LOAD HOLDS ITS SPACE. Bare "Loading…" let the room
          collapse to one line and snap back; five fixed-height rows in the
          list's own geometry mean content lands into held space. */}
      {isLoading &&
        Array.from({ length: 5 }, (_, i) => (
          <Box
            key={`sk-${i}`}
            sx={{
              height: 58,
              mb: 1,
              borderRadius: "14px",
              backgroundColor: "rgba(255,255,255,.035)",
              animation: "poppinProfileBreathe 1.6s ease-in-out infinite",
              animationDelay: `${i * 90}ms`,
              "@keyframes poppinProfileBreathe": {
                "0%, 100%": { opacity: 0.45 },
                "50%": { opacity: 0.8 },
              },
            }}
          />
        ))}
      {/*
        THREE DIFFERENT SILENCES, three sentences. One line used to cover
        an empty category, a search miss and a failed fetch - and a failed
        fetch wearing "Nothing here" is failure shown as absence, the class
        this codebase keeps paying for.
      */}
      {!isLoading && isError && (
        <Typography
          component="button"
          onClick={() => void refetch()}
          sx={{
            fontSize: 13,
            color: DIM,
            background: "none",
            border: "none",
            cursor: "pointer",
            p: 0,
            textAlign: "left",
            font: "inherit",
          }}
        >
          Couldn't load. Tap to try again.
        </Typography>
      )}
      {!isLoading && !isError && tokens.length === 0 && (
        <Typography sx={{ fontSize: 13, color: DIM }}>
          {query ? `No tokens match "${query}".` : "Nothing here right now."}
        </Typography>
      )}

      {/* Stale rows stay put, DIMMED, while the next category loads - the
          list never collapses into a teleport. */}
      <Box
        sx={{
          opacity: isFetching && tokens.length > 0 ? 0.5 : 1,
          transition: "opacity .16s ease-out",
        }}
      >
      {tokens.map((t) => {
        const price = num(t.price)
        const chg = num(t.priceChange24h)
        const mc = num(t.marketCap)
        return (
          <Box
            key={t.address}
            onClick={() =>
              navigate(`/token/${t.address}`, {
                state: { seed: { displayName: t.name, symbol: t.symbol } },
              })
            }
            className="click-animation"
            sx={{
              display: "flex", alignItems: "center", gap: 1.25, py: 1.25,
              borderBottom: "1px solid rgba(255,255,255,.06)", cursor: "pointer",
            }}
          >
            {t.logoURI ? (
              <Box component="img" src={t.logoURI} alt="" sx={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0 }} />
            ) : (
              <Box sx={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", backgroundColor: "rgba(255,255,255,.08)", fontSize: 12, fontWeight: 700 }}>
                {(t.symbol || "?").charAt(0)}
              </Box>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ${(t.symbol || "").replace(/^\$/, "")}
                <Box component="span" sx={{ ml: 0.75, fontSize: 11.5, fontWeight: 500, color: DIM }}>
                  {t.name}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: DIM, fontVariantNumeric: "tabular-nums" }}>
                {mc !== null && mc > 0 && `MC ${compactMoney(mc)}`}
                {typeof t.holders === "number" && t.holders > 0 && ` · ${t.holders.toLocaleString("en-US")} holders`}
              </Typography>
            </Box>
            <Box sx={{ textAlign: "right", flexShrink: 0 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {price !== null && price > 0 ? priceText(price) : "—"}
              </Typography>
              {chg !== null && (
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: chg >= 0 ? GREEN : RED, fontVariantNumeric: "tabular-nums" }}>
                  {chg >= 0 ? "+" : ""}
                  {chg.toFixed(1)}%
                </Typography>
              )}
            </Box>
          </Box>
        )
      })}
      </Box>
    </Box>
  )
}
