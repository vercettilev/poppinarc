import { Box, Typography } from "@mui/material"
import { alpha } from "@mui/material/styles"
import { XIcon } from "~/components/icons"
import { ACCENT, DIM, PANEL_CARD } from "~/helpers/panelSurface"
import { knownCashUsd } from "~/helpers/readerCash"
import { JUICE } from "~/theme/juice"

/**
 * THE FRONT DOOR'S DOORS. "Pop it on X" says where and what to do; it does
 * not explain a chip. Every door lands on a page where a chip is certain,
 * measured through the matcher the strip itself runs (2026-09-17):
 *
 *  · X: the live $SOL search. Every tweet carries the cashtag; cashtag tier.
 *  · Reddit: r/solana. 13 of 25 hot titles match on the name tier, three
 *    of the first eight; the pinned welcome post matches too.
 *  · CNBC: Nvidia's quote page. The headline "NVIDIA Corporation
 *    NVDA:NASDAQ" matches NVDAx on the name tier, and the news adapter
 *    puts the chip under the h1.
 *
 * The logos are the onboarding's method: X is the brand glyph the sign-in
 * screen already draws, the other two are the sites' own favicons through
 * Google's favicon service at a rung above render size. No third-party
 * brand is redrawn by hand.
 *
 * A new door is added only with a measured destination. Three is the
 * ceiling: the screen must not become a directory.
 */
export const DOORS = [
  {
    id: "x",
    title: "Pop it on X",
    line: "Live $SOL timeline. Every tweet there wears a chip.",
    url: "https://x.com/search?q=%24SOL&f=live",
    iconDomain: null,
    lead: true,
  },
  {
    id: "reddit",
    title: "Pop it on Reddit",
    line: "r/solana. Posts about Solana wear a chip.",
    url: "https://www.reddit.com/r/solana/",
    iconDomain: "reddit.com",
    lead: false,
  },
  {
    id: "cnbc",
    title: "Pop it on CNBC",
    line: "Nvidia's quote page. The headline wears a chip.",
    url: "https://www.cnbc.com/quotes/NVDA",
    iconDomain: "cnbc.com",
    lead: false,
  },
] as const

/** Google's favicon ladder is 16, 32, 64, 128 and rounds down: ask for a rung above render size. */
const faviconUrl = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

const openDoor = (door: (typeof DOORS)[number]) => {
  try {
    void chrome.runtime.sendMessage({
      type: "SPOT_TELEMETRY",
      event: "panel_door",
      payload: { site: door.id },
    })
  } catch {
    // Counting is never worth failing the door over.
  }
  try {
    chrome.tabs.create({ url: door.url })
  } catch {
    window.open(door.url, "_blank", "noopener")
  }
}

export function PopDoors() {
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: JUICE.text3,
          mt: 0.5,
        }}
      >
        Pop it on
      </Typography>
      {DOORS.map((d) => (
        <Box
          key={d.id}
          component="button"
          onClick={() => openDoor(d)}
          className="click-animation"
          data-door={d.id}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            width: "100%",
            textAlign: "left",
            font: "inherit",
            color: "inherit",
            cursor: "pointer",
            p: "12px 14px",
            borderRadius: "14px",
            border: `1px solid ${d.lead ? alpha(ACCENT, 0.4) : JUICE.border}`,
            background: d.lead
              ? `linear-gradient(180deg, ${alpha(ACCENT, 0.14)}, ${alpha(ACCENT, 0.06)})`
              : JUICE.well,
            transition: "border-color .15s ease-out",
            "&:hover": { borderColor: alpha(ACCENT, 0.5) },
          }}
        >
          {d.iconDomain === null ? (
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: "12px",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: "#000",
                border: "1px solid rgba(255,255,255,.18)",
              }}
            >
              <XIcon sx={{ fontSize: 20, color: "#FFFFFF" }} />
            </Box>
          ) : (
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: "12px",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: JUICE.wellSolid,
                border: `1px solid ${JUICE.border}`,
              }}
            >
              <Box
                component="img"
                src={faviconUrl(d.iconDomain)}
                alt=""
                width={24}
                height={24}
                sx={{ width: 24, height: 24, display: "block", borderRadius: "6px" }}
              />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>{d.title}</Typography>
            <Typography sx={{ fontSize: 12, color: DIM }}>{d.line}</Typography>
          </Box>
          <Typography sx={{ color: JUICE.text3, fontSize: 16, flexShrink: 0 }}>›</Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * THE EMPTY BOOK, said once. No $0.00 headline, no P&L line, no dash:
 * a zero is a claim of a book, and there is none yet. One sentence for
 * the state the reader is in, and the cash line under it.
 *
 * THE DEPOSIT DOOR USED TO BE A LINK AT THE END OF THAT CASH LINE — 12px,
 * tertiary, after the word "USDC", on the screen whose measured problem is
 * that nobody funds. components/FundDoor.tsx is that ask made a door and
 * given the top of the screen, and it stands above this card, so the link
 * here would be the same room offered twice.
 *
 * AN UNKNOWN BALANCE IS NOT A ZERO. This used to be handed `cashUsd ?? 0`,
 * which printed "Cash $0.00 USDC" as a fact about a book that had not said
 * — the same claim the P&L dash above exists to avoid. The line waits for
 * a number instead (helpers/readerCash.ts).
 */
export function FrontDoorEmpty({ cashUsd }: { cashUsd: number | null | undefined }) {
  const known = knownCashUsd({ cashUsd })
  const funded = known !== null && known > 0
  const cash = known?.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
  return (
    <Box sx={{ ...PANEL_CARD, p: 2, mb: 2 }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: JUICE.text }}>
        {funded ? "Your cash is ready." : "Nothing in yet."}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: DIM, mt: 0.5 }}>
        {funded
          ? "Nothing held yet. The chip under a tweet is the Buy button."
          : "Pick a place below. Every coin there wears a live chip. The chip is the Buy button."}
      </Typography>
      {cash !== undefined && (
        <Typography sx={{ fontSize: 12, color: DIM, mt: 1 }}>
          Cash&nbsp;
          <Box component="span" sx={{ color: "#FFFFFF", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {cash}
          </Box>
          &nbsp;USDC
        </Typography>
      )}
    </Box>
  )
}
