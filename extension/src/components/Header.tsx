import { JUICE } from "~/theme/juice"
import Groups2OutlinedIcon from "@mui/icons-material/Groups2Outlined"
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined"
import {
  alpha,
  Box,
  IconButton,
  MenuItem,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material"
import { useQueryClient } from "@tanstack/react-query"
import {
  fetchPagePresence,
  siteLivePillLabel,
  startSitePresenceHeartbeat,
} from "~/helpers/presence"
import {
  SITE_CHAT_MIN_POPULATION,
  siteChatGateView,
  type SiteChatGateState,
} from "~/helpers/siteChatGate"
import { siteChatHostFromUrl } from "~/helpers/siteChatHost"
import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { useToast } from "~/components/Toast/ToastProvider"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { auth } from "~/lib/firebase"
import { isQuietRoute } from "~/helpers/quietRoutes"
import { signOutEverywhere } from "~/helpers/signOut"
import { usePostsCount } from "~/hooks/usePostsCount"
import { ReferralService } from "~/services/ReferralService"
import {
  useAppConfigStore,
  useEnvironmentStore,
} from "~/store/useAppConfigStore"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useSiteChatStore } from "~/store/useSiteChatStore"
import { useSortStore } from "~/store/useSortStore"
import { useUIStore } from "~/store/useUIStore"
import { useViewStore } from "~/store/useViewStore"
import { formatCompactNumber } from "~/utils/numberUtils"
import HomeSmileIcon from "~/assets/home-smile.svg"
import { CAvatar } from "./CAvatar"
import {
  HomeIcon,
  LetterKIcon,
  ReferralIcon,
  StockMarketIcon,
  TaskIcon,
} from "./icons"
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined"
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined"
import LogoutIcon from "@mui/icons-material/Logout"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone"
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined"
import { DittoBadge } from "./Post/PostHeader"
import { CAP } from "~/config/edition"

interface MenuItem {
  label: string
  path?: string
  /**
   * The row's leading glyph. ONE family (MUI outlined), one size, one
   * colour — the menu used to mix hand-rolled inline SVGs, a PNG, and two
   * rows with no glyph at all, which is what made it read as unfinished
   * rather than as a deliberate text menu.
   */
  icon?: React.ReactNode
  /** Rendered at the far end of the row — a count, a state. */
  trailing?: React.ReactNode
  /** Rows are separated by a hairline where the group changes. */
  group?: "you" | "money" | "community"
  customComponent?: React.ReactNode
}

/** The glyph column: fixed width, so every label starts on the same x. */
const GLYPH_SX = { fontSize: 18, opacity: 0.62 } as const

export function Header() {
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: currentUser } = useCurrentUser()
  const { view, setView } = useViewStore()
  /**
   * THE TASKS FETCH IS GONE. It ran on every panel open, for every signed-in
   * reader, to compute `claimableTasksCount` — which nothing rendered. On
   * the server that read lazily seeds and syncs a reader's task rows, so an
   * unread number was paying for writes on every open. The screen those
   * rows belonged to is retired (panel audit, 2026-09-20).
   */

  const currentUrl = useCurrentUrlStore.getState().currentUrl
  // Reactive twin of the snapshot above — the presence pill must follow the
  // active tab, and getState() never re-renders.
  const liveUrl = useCurrentUrlStore((state) => state.currentUrl)

  /**
   * ── THE LIVE PILL ──────────────────────────────────────────────────────
   *
   * "N live" for the website the panel is looking at, and the door to its
   * live chat. It reads TWO different numbers, and which one it reads is the
   * whole shape of this block:
   *
   *   THE POOL (preferred) — every reader with Poppin alive on this hostname,
   *     written by the heartbeat below and counted by the same Redis ZSET the
   *     server's admission gate reads. The pill must show THIS number
   *     whenever there is a door, because a pill that says "3 live" over a
   *     gate that counted 1 would offer a door the server then refuses.
   *
   *   THE PAGE COUNT (fallback) — /ticks page-room size, the number this pill
   *     has always shown and the number the trade card's head still shows.
   *     Used whenever the pool has nothing honest to say: the server says site
   *     chat does not exist here — the default, since SITE_CHAT_ENABLED is off
   *     until a human turns it on — or a beat came back carrying no number.
   *     While it is off, this pill and the card show the SAME number, which
   *     is the promise helpers/presence.ts makes. The day chat is switched on
   *     they diverge, and the card should move to the pool with it —
   *     components/SpotCard/pagePosts.ts is where that one line lives.
   *
   * Both render through ONE pill and one threshold. null is not 0 anywhere in
   * here: an unknown count draws nothing, because a presence line showing 0
   * tells every reader the place is dead.
   */
  /**
   * TWO HOSTS FOR TWO ROOMS, and they are not the same string on purpose.
   *
   * `siteHost` is the CANONICAL website — www./m./mobile. folded away, IPs and
   * single-label hosts refused — because a site chat room is one room per
   * website (R1) and `x.com`, `www.x.com` and `m.x.com` must all land in it.
   *
   * `pageHost` is the raw hostname, because the /ticks page room is keyed by
   * exactly that and the trade card asks for it with `location.hostname`
   * (components/SpotCard/spotCardFlow.ts calls fetchPresence that way).
   * Folding here would ask for a different room than the card asks for, and
   * the two surfaces would print two numbers for one page — which is the one
   * thing helpers/presence.ts exists to prevent.
   */
  const siteHost = useMemo(() => siteChatHostFromUrl(liveUrl), [liveUrl])
  const pageHost = useMemo(() => {
    try {
      const u = new URL(liveUrl ?? "")
      if (u.protocol !== "http:" && u.protocol !== "https:") return null
      return u.hostname || null
    } catch {
      // not a real page URL (chrome://, empty) — the pill stays hidden
      return null
    }
  }, [liveUrl])

  const [pagePresence, setPagePresence] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    setPagePresence(null)
    if (!pageHost) return
    void fetchPagePresence(pageHost).then((n) => {
      if (alive) setPagePresence(n)
    })
    return () => {
      alive = false
    }
  }, [pageHost])

  /**
   * THE PANEL'S HALF OF THE HEARTBEAT.
   *
   * The side panel is a real document, so its timers actually run — which is
   * the entire reason the beat is here and not on a setInterval in the MV3
   * background worker, where Chrome's idle eviction would kill it and freeze
   * the count on a stale number that still looks like an answer. The content
   * script beats for the page itself, a chrome.alarms backstop beats in the
   * background, and the chat store runs a fourth beat for the host the chat
   * screen is pointed at (store/useSiteChatStore.ts). Every one of them writes
   * the SAME member id and the server's write is an idempotent ZADD, so four
   * writers never become four people — they cost requests, not members, and
   * the store's is the redundant one while this header is on screen.
   *
   * Keyed on the host: a new website is a new room and deserves an immediate
   * beat rather than the tail of the previous room's interval.
   *
   * KNOWN COST, WRITTEN DOWN RATHER THAN HIDDEN: this beat names the INSTALL,
   * never the signed-in person, so one person reading the same site on two
   * machines is two members of the pool. Every presence write in the extension
   * is anonymous for that reason — the chat socket deliberately writes none at
   * all (helpers/siteChatTransport.ts:24-39) — so a reader is never counted
   * twice on ONE machine, which is the case the gate actually turns on.
   *
   * IT STOPS WHERE THE HEADER STOPS. Layout.tsx renders no header on
   * /sign-in, /create-profile, /receive, /send and /send-details, so the
   * panel's beat pauses on those five screens. Nothing breaks: the page's own
   * content script is still beating for the same member.
   */
  const [pool, setPool] = useState<{
    count: number | null
    at: number
    available: boolean
  }>({ count: null, at: 0, available: true })
  useEffect(() => {
    setPool({ count: null, at: 0, available: true })
    if (!siteHost) return
    return startSitePresenceHeartbeat(siteHost, (r) => {
      setPool({ count: r.count, at: Date.now(), available: r.available })
    })
  }, [siteHost])

  /**
   * MEMBERSHIP, WHICH NO COUNT MAY CLEAR (R5's visible half).
   *
   * A reader the server admitted keeps their door when everyone else leaves,
   * so the pill must know about admission — and admission is a durable server
   * record that arrives over the socket, into the store's gate
   * (store/useSiteChatStore.ts). It is read here rather than re-derived: two
   * pictures of one membership is exactly the disagreement this feature is
   * built to avoid.
   *
   * HOST-SCOPED, because the store follows the chat screen's page and this
   * header follows the panel's. Membership of x.com must not draw a door over
   * a tab showing another website.
   *
   * WHAT THIS DOES NOT COVER, said rather than hidden. The store survives a
   * closed panel by keeping a per-host membership hint in chrome.storage.local
   * and re-sending `join` for a hinted host (`resumeMembership`, and the
   * `siteChat.memberHints` key it reads, in store/useSiteChatStore.ts) — the
   * protocol has no verb that asks "am I already a member?", so a re-join is
   * the whole of it. But that resume runs from `setPage`, and views/live-chat.
   * tsx is the ONLY caller: a panel session that never opens the chat screen
   * never asks, so on a fresh open this reads `member: false` on every other
   * route. The pill then under-promises rather than lies — it hides while the
   * room is quiet — and Layout restoring the chat route is what makes that
   * self-correcting: the reader lands there, the store resumes, and from that
   * moment the pill knows. Pointing the store at the panel's page from HERE
   * would fix it and would also open a chat socket for every reader on every
   * route, which is not a cost this header may decide to spend.
   */
  const member = useSiteChatStore(
    (s) => s.gate.member && s.host !== null && s.host === siteHost,
  )

  /**
   * What to draw, decided by the shared reducer rather than here — the same
   * function the chat screen paints from, so the pill and the room can never
   * disagree about whether the door is open.
   *
   * `blocked` IS FED FROM THE HEARTBEAT'S 404 rather than pinned to null: the
   * reducer puts `disabled` ABOVE member on purpose, so a feature switched off
   * takes the door away from everyone, members included (O3 — the extension
   * must render exactly as it does today while chat is dark). Deciding that
   * here would be a second gate.
   *
   * Date.now() at render is fine BECAUSE the heartbeat re-renders this
   * component every beat, so the count's age is re-judged on that cadence.
   */
  const gate: SiteChatGateState = {
    host: siteHost,
    count: pool.count,
    countAt: pool.at,
    member,
    signedIn: Boolean(currentUser),
    blocked: pool.available ? null : "disabled",
  }
  const liveView = siteChatGateView(gate, Date.now())

  /**
   * THE FACT PILL'S NUMBER — the count this header drew before chat existed,
   * and the answer to two different silences.
   *
   *   NO DOOR HERE — the beat came back 404: site chat is off, or this host is
   *     not allowed one. Then the pill is exactly what it has always been.
   *
   *   COULD NOT ASK — the beat answered with no number at all (offline, a 429
   *     off the per-IP ping limiter, a 500). `pool.at > 0` is what separates
   *     that from "has not answered yet", so this can never flash a pill
   *     before the first beat lands. Falling back beats blanking: /ticks has
   *     already told us how many browsers are on this page, and that number
   *     was this pill's entire content until site chat existed.
   *
   * A FACT IN BOTH CASES — no onPress. The pool is the number the server's
   * gate counts, and a door over a number the gate did not produce is a door
   * the server may refuse.
   */
  const factPresence =
    (!pool.available || (pool.at > 0 && pool.count === null)) &&
    typeof pagePresence === "number" &&
    pagePresence >= SITE_CHAT_MIN_POPULATION
      ? pagePresence
      : null
  const { organization } = useAppConfigStore()
  const { environment } = useEnvironmentStore()

  // The automatic URL joining is handled by the background script's updateCurrentUrl function
  // which is triggered by tab changes and URL updates. No additional logic needed here.

  /**
   * THE INBOX IS CLOSED, SO ITS COUNT IS NOT POLLED.
   *
   * apps/rabbit is the only writer of notification rows and it writes seven
   * kinds: follow, comment, reply, mention, share, post_deleted_by_admin,
   * stream_created. Not one of them is a money event — an order that filled,
   * an alert that rang, someone you follow trading — so the badge could
   * only ever count the retired social product, over an inbox two people
   * had ever opened. The money events keep their own surfaces: the front
   * door marks unread fills, the chip's bell is the alert room, and the
   * OS notification is what actually reaches a reader who is away
   * (panel audit, 2026-09-20).
   */
  const [isLogoutLoading, setIsLogoutLoading] = useState(false)
  const { sort, setSort } = useSortStore()

  /**
   * How many tradeable ideas this page carries. Asked of the page's own
   * content script (which already reads the page for the card) rather than
   * re-scraped here — the panel cannot see the DOM it is docked next to.
   *
   * null while unknown and on pages with no content script, which renders no
   * count at all: an absent number is honest, a 0 would claim we looked.
   */

  const { data: postsCountData } = usePostsCount(currentUrl)
  /**
   * UNDEFINED, NOT ZERO, and the comment above already said so — the code
   * simply did the opposite. Both branches of the old ternary collapsed to
   * the same expression and both floored to 0, so loading, error, empty and
   * "this page genuinely has none" all rendered "Feed • 0": a number that
   * claims we looked and found nothing, on a page where we mostly had not
   * looked yet. HeaderPillTab already hides the dot and the number when the
   * count is undefined, so an unknown count now shows a clean "Feed".
   */
  const postsCount = useMemo(() => {
    const n = postsCountData?.[0]?.count
    return typeof n === "number" && n > 0 ? n : undefined
  }, [postsCountData])

  // (There was a "Get online count from Zustand store" comment here with no
  //  code under it. No store holds that number: the pill's count comes from
  //  the presence heartbeat above, and saying otherwise sent the next reader
  //  hunting for a socket that does not exist.)

  // Add these state variables for drawer control
  /**
   * The account menu's anchor.
   *
   * It was a right-hand Drawer covering 65% of the panel behind a blurred
   * backdrop — a full-screen pattern for seven destinations in a 400px
   * column. Opening it hid the thing you were reading, and closing it was a
   * second deliberate act. A popover hung off the avatar answers the same
   * question without taking the room, and it matches FeedFilterButton, the
   * panel's other menu.
   */
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)

  const { isSignInModalOpen, setIsSignInModalOpen } = useUIStore()

  const handleClose = () => setMenuAnchor(null)

  // Add effect to sync view with current route
  useEffect(() => {
    // Check if navigation state has a sort value
    if (location.state?.sort) {
      setSort(location.state.sort)
      // Clear the state to prevent it from persisting
      navigate(location.pathname, { replace: true })
    }

    // Check if ProfileDetailView is open
    if (location.state?.to === "ProfileDetailView") {
      setView(null)
      setSort("currentUrl")
    } else if (location.pathname === "/feed" && sort !== "timeline") {
      // "/feed", not "/" — the third stale copy of the pre-restructure
      // root. The first two (the tab pill's target, the chip's door)
      // were each found by a reader pressing a control that landed
      // somewhere else; this one UNDID the Global Feed button: it set
      // sort to timeline, this effect saw a pathname that was not "/",
      // and snapped the sort straight back — a button that reverts
      // itself within one render.
      setView("comment")
    } else if (location.pathname === "/announcements") {
      setView("announcements")
    } else {
      setView(null)
      // Reset sort when navigating to non-feed routes (profile, messages,
      // etc.); the feed is the one place the global sort may stand.
      if (sort === "timeline" && location.pathname !== "/feed") {
        setSort("currentUrl")
      }
    }
  }, [location.pathname, location.state, sort, setSort, navigate])

  /**
   * Browsing to a new page drops the GLOBAL feed back to this page's feed —
   * the panel is page-scoped, so a fresh page means fresh posts.
   *
   * GUARDED TO THE FEED ROUTE, and that guard is the bug fix. Without it this
   * fired wherever the reader was: press Trades while the global feed was up,
   * let any URL broadcast land, and the unconditional navigate("/") threw
   * them back to Posts. Reported as "Trades button doesn't work".
   *
   * There is no navigate() left because there is nothing to navigate to: the
   * only case this now runs in is already on "/". It changes what the feed
   * SHOWS, not where the reader is.
   */
  useEffect(() => {
    if (sort === "timeline" && location.pathname === "/feed") {
      setView("comment")
      setSort("currentUrl")
    }
  }, [currentUrl])

  const handleChange = async (
    _event: React.SyntheticEvent,
    newView: "comment"
  ) => {
    if (newView !== null) {
      /**
       * "/feed", not "/" — the panel's root became SpotPositions in the
       * restructure and this pill kept its old target, so a control
       * labelled Feed opened Positions and the /feed route had NO entrance
       * anywhere in the extension. The sort/view writes below stay: the
       * feed reads `sort` to choose page-feed vs global-feed.
       */
      navigate("/feed")
      setView(newView)

      setTimeout(() => {
        setSort("currentUrl")
      }, 100)
    }
  }

  // Build menu items based on login state
  const menuItems: MenuItem[] = !currentUser
    ? [
        {
          label: "Log in",
          customComponent: (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                fontSize: "12px",
                py: 0,
              }}
            >
              <LoginOutlinedIcon sx={{ fontSize: 16 }} />
              <Typography sx={{ fontSize: "12px" }}>Log in</Typography>
            </Box>
          ),
          path: undefined, // No path, will handle click
        },
      ]
    : [
        /* Profile has no row: the identity chip at the top of the menu is
           the profile door, and two doors to the same page is one too many. */
        // A wallet account's wallet is Phantom; the embedded one it never
        // uses (with an Export private key) is not a tab it should see.
        ...(currentUser?.wallet_mode === "external"
          ? []
          : [
              {
                label: "Wallet",
                path: "/wallet-ui",
                group: "money" as const,
                icon: <AccountBalanceWalletOutlinedIcon sx={GLYPH_SX} />,
              },
            ]),
        /*
         * Positions is NOT here, and the reason got stronger: it is now the
         * panel's front door. Opening the panel IS opening the book, so a
         * menu entry would be a door to the room you are standing in. The
         * /positions route still exists for deep links.
         */
        // The points board lives on the store backend only.
        ...(CAP.gamification
          ? [
              {
                label: "Leaderboard",
                path: "/flywheel",
                group: "community" as const,
                icon: <EmojiEventsOutlinedIcon sx={GLYPH_SX} />,
              },
            ]
          : []),
        /*
         * ONE ROW, ONE SCREEN. "Report a bug" used to sit directly below
         * this entry as a second row — and it pointed at "/settings?report=1",
         * i.e. the SAME screen this row opens. Two rows landing a reader on
         * one destination is a menu telling them the panel has two places
         * when it has one, and the only thing distinguishing them was a
         * scroll effect in the view. The bug box now lives at the BOTTOM of
         * Settings (views/Settings.tsx), where a reader who has scrolled
         * past every preference without finding a fix arrives at it anyway.
         * The ?report=1 deep link, its ref and its scroll effect went with
         * the row; nothing else in the repo ever produced that URL.
         */
        {
          label: "Settings",
          path: "/settings",
          icon: <SettingsOutlinedIcon sx={GLYPH_SX} />,
        },
        {
          label: "Logout",
          path: "/logout",
          icon: <LogoutIcon sx={GLYPH_SX} />,
        },
      ]

  const handleMenuItemClick = async (
    path?: string,
    label?: string,
  ) => {
    handleClose()

    // Track specific menu item click with descriptive event name
    if (label) {
      const eventName = `menu_${label.toLowerCase().replace(/\s+/g, "_")}_clicked`
          }

    if (label === "Log in") {
      setIsSignInModalOpen(true)
      return
    }
    if (path === "/profile") {
      if (!currentUser) {
        setIsSignInModalOpen(true)
        return
      }
    }
    if (path === "/logout") {
      await performLogout()
      return
    } else if (path) {
      navigate(path)
    }
  }

  /**
   * Full logout: clear every client-side surface that holds auth state,
   * then fire-and-forget the web /logout iframe to clear server-side
   * session cookies. The previous implementation only fired the iframe
   * and relied on its postMessage to drive the cleanup — when the
   * message never came back (CSP / blocked iframe / network), the user
   * stayed logged in.
   */
  const performLogout = async () => {
    setIsLogoutLoading(true)
    try {
      // The procedure itself lives in helpers/signOut.ts; Settings' own
      // Sign out calls the same one.
      await signOutEverywhere(queryClient)

      showToast("Logged out successfully.", "success")
      navigate("/")

      // 6) Close the surface. The sidepanel closes itself.
      if (environment === "sidepanel") {
        window.close()
      }
    } finally {
      setIsLogoutLoading(false)
    }
  }

  const { showToast } = useToast()

  const queryClient = useQueryClient()

  // (The old "poppin-logout" postMessage listener has been removed.
  // performLogout() now drives the whole flow client-side and no longer
  // depends on the iframe to ping back — that ping was the unreliable
  // step that left users half-logged-out when the iframe was blocked.)

  // Derived active-tab state from the route so the pill stays in sync.
  const isPostsActive = location.pathname === "/feed"
  /**
   * A QUIET ROUTE IS NOT ABOUT THE PAGE (helpers/quietRoutes.ts). The
   * feed's doors come off the header there and a way back takes the
   * home button's slot; the screen keeps its own title.
   */
  const quiet = isQuietRoute(location.pathname)

  // Canonical brand accent — sourced from theme so org overrides
  // (white-label deployments) automatically propagate.
  const ACCENT = theme.palette.primary.main

  return (
    <>
      <Box
        sx={{
          // Transparent, so the shell's lit ground (and its auroras) runs
          // unbroken behind the row. A painted #000 shelf on a #07070A
          // canvas is a seam you can see.
          backgroundColor: "transparent",
          px: "10px",
          py: "10px",
          position: "relative",
        }}
        color="transparent"
        id="header"
      >
        {/* Every chrome element in this row — home, tab pill, chat,
            avatar — is exactly 36×36 and separated by
            a uniform 8px gap. The radii are all `999px` so the row
            reads as a series of pills (the home/chat/avatar are
            perfect circles; the tab pill is a wider capsule). */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {/* Home button — 36x36 circle. Brand-blue when on the
              global feed, quiet glass when not.

              IT SAID "Global Feed" AND WENT TO POSITIONS. The panel's root
              became SpotPositions in the restructure; this button kept
              navigating to "/" while still setting sort:"timeline", so it
              opened Positions AND made ActionBar stamp a "Global Feed"
              label row over it. Now it goes where its own tooltip says. */}
          {quiet ? (
            <IconButton
              aria-label="Back"
              className="click-animation"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
              sx={{
                width: 36,
                height: 36,
                borderRadius: "999px",
                color: "#FFFFFF",
                flexShrink: 0,
                backgroundColor: alpha("#FFFFFF", 0.06),
                border: `1px solid ${alpha("#FFFFFF", 0.1)}`,
                "&:hover": { backgroundColor: alpha("#FFFFFF", 0.12) },
              }}
            >
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
          ) : (
          <Tooltip
            title="Global Feed"
            arrow
            placement="bottom"
            componentsProps={{
              tooltip: {
                sx: { fontSize: "0.75rem", px: 1, py: 0.5 },
              },
            }}
          >
            <IconButton
              id="home-tab"
              className="click-animation"
              onClick={() => {
                navigate("/feed", { state: { sort: "timeline" } })
              }}
              sx={{
                width: 36,
                height: 36,
                borderRadius: "999px",
                // Active: black icon on brand blue. Idle: white icon on
                // glass — same active-state contract as the chat button
                // and the tab pill.
                color: sort === "timeline" ? "#000" : "#FFFFFF",
                flexShrink: 0,
                backgroundColor:
                  sort === "timeline" ? ACCENT : alpha("#FFFFFF", 0.06),
                border: `1px solid ${
                  sort === "timeline"
                    ? alpha(ACCENT, 0.5)
                    : alpha("#FFFFFF", 0.1)
                }`,
                transition: "background-color .15s ease, color .15s ease",
                "&:hover": {
                  backgroundColor:
                    sort === "timeline"
                      ? alpha(ACCENT, 0.85)
                      : alpha("#FFFFFF", 0.12),
                },
              }}
            >
              <Box
                component="img"
                src={HomeSmileIcon}
                alt="home"
                sx={{
                  width: 18,
                  height: 18,
                  display: "block",
                  filter:
                    sort === "timeline"
                      ? "brightness(0)"
                      : "brightness(0) invert(1)",
                }}
              />
            </IconButton>
          </Tooltip>
          )}

          {/* The ONE feed's pill. The Posts/Trades tab bar died with the
              owner's call — one feed per page, trades ride it as receipts
              and the top strip answers the money question. What remains is
              the label + live post count, still a button: it takes you home.
              A one-tab tab bar is a label pretending to be a control, so the
              frame is gone too — this is a pill, not a bar. */}
          {quiet ? (
            <Box sx={{ flex: 1 }} />
          ) : (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              height: 36,
              minWidth: 0,
            }}
          >
            <HeaderPillTab
              id="posts-tab"
              active={isPostsActive}
              accent={ACCENT}
              label="Feed"
              count={postsCount}
              onClick={(e) => handleChange(e as any, "comment")}
            />
          </Box>
          )}

          <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* THE LIVE PILL. Two sources, one pill, one threshold — see the
                block that computes `liveView`. From 2 up for anyone who is
                not already a member: a count of 1 is the reader themselves,
                and 0 would tell every visitor the place is dead. A member
                keeps the pill at any count, and it drops the number rather
                than say "1 live" — that is R5 on screen.

                THE GATE'S PILL WINS WHEN THERE IS ONE. `factPresence` is the
                older /ticks number and only draws when the gate has nothing
                honest to say: the feature is dark, or the beat could not
                answer. It is a fact with no onClick — shipping a button to a
                door that is not there is worse than shipping no button. */}
            {!quiet && liveView.visible ? (
              <SiteLivePill
                label={siteLivePillLabel(liveView)}
                host={siteHost}
                accent={ACCENT}
                onPress={
                  liveView.pressable
                    ? () => {
                        // The gate is the SERVER's; this only chooses which
                        // door to knock on. A reader with no identity the
                        // server accepts is sent to sign in rather than into
                        // a room that would refuse them.
                        if (liveView.state === "SIGNED_OUT") {
                          setIsSignInModalOpen(true)
                          return
                        }
                        navigate("/live-chat")
                      }
                    : undefined
                }
              />
            ) : (
              factPresence !== null && (
                <SiteLivePill label={`${factPresence} live`} />
              )
            )}
            {/* THE FUNNEL IS NOT HERE ANY MORE. It sat in this group — sort,
                kind and the whole-site toggle — but Layout hands a header to
                nearly every route, so a control whose settings only the feed
                reads was on screen over Positions, Wallet, Tasks and
                Notifications, doing nothing visible on any of them. It now
                rides the feed's own label row (components/ActionBar.tsx),
                next to the label it filters. Do not re-add it here: this row
                is panel chrome, and the feed's controls are the feed's. */}

            <Box sx={{ position: "relative", flexShrink: 0 }}>
              <CAvatar
                id="profile-menu"
                onClick={(e: React.MouseEvent<HTMLElement>) =>
                  setMenuAnchor(e.currentTarget)
                }
                sx={{ width: 36, height: 36, cursor: "pointer" }}
                src={currentUser?.profile_photo_url || undefined}
              />
              {/* NO BADGE. It counted the social inbox, which is closed. */}

              <Popover
                open={Boolean(menuAnchor)}
                anchorEl={menuAnchor}
                onClose={handleClose}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                PaperProps={{
                  sx: {
                    // Same paper as the feed's filter popover — one menu
                    // surface in the panel, not two.
                    backgroundColor: JUICE.ground,
                    backgroundImage: "none",
                    border: `1px solid ${alpha("#FFFFFF", 0.08)}`,
                    borderRadius: "14px",
                    marginTop: "6px",
                    width: 232,
                    boxShadow: `0 16px 40px ${alpha("#000", 0.6)}`,
                  },
                }}
              >
                <Box sx={{ p: "10px" }}>
                  {/* The identity row IS the profile door — tapping who you
                      are opens your page, so "Profile" needs no second row
                      below. Name falls back to the username: a fresh Google
                      account has no display_name, and the empty Typography
                      was what let the ditto chip drift onto the avatar. */}
                  {currentUser && (
                    <Box
                      component="button"
                      onClick={() => {
                        handleClose()
                        navigate("/profile")
                      }}
                      className="click-animation"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        width: "100%",
                        minWidth: 0,
                        px: 1,
                        py: 1,
                        cursor: "pointer",
                        font: "inherit",
                        textAlign: "left",
                        borderRadius: "12px",
                        background: `linear-gradient(180deg, ${alpha(
                          ACCENT,
                          0.1
                        )} 0%, ${alpha(ACCENT, 0.02)} 100%)`,
                        border: `1px solid ${alpha(ACCENT, 0.18)}`,
                        "&:hover": {
                          background: `linear-gradient(180deg, ${alpha(
                            ACCENT,
                            0.16
                          )} 0%, ${alpha(ACCENT, 0.05)} 100%)`,
                        },
                      }}
                    >
                      <CAvatar
                        src={currentUser.profile_photo_url || undefined}
                        size="medium"
                        sx={{ width: 38, height: 38, flexShrink: 0 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          sx={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#FFFFFF",
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {currentUser.display_name || currentUser.username}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: "11px",
                            color: alpha("#FFFFFF", 0.55),
                            lineHeight: 1.25,
                          }}
                        >
                          @{currentUser.username}
                        </Typography>
                      </Box>
                      {/* The score sits in its own end slot, off the text. */}
                      <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                        {CAP.gamification && <DittoBadge ditto={currentUser.ditto || 0} />}
                      </Box>
                    </Box>
                  )}

                  {/* Main menu items */}
                  <Box sx={{ mt: "10px" }}>
                    {menuItems
                      .filter(
                        (item) =>
                          !item.label.toLowerCase().includes("settings") &&
                          !item.label.toLowerCase().includes("logout")
                      )
                      .map((item, i, list) => (
                        <Box key={item.label}>
                          {/* A hairline only where the KIND of destination
                              changes — you, then money, then community.
                              Seven undifferentiated rows is a list; three
                              small groups is a menu you can aim at. */}
                          {i > 0 && item.group !== list[i - 1].group && (
                            <Box
                              sx={{
                                height: "1px",
                                backgroundColor: alpha("#FFFFFF", 0.07),
                                my: 1,
                                mx: "12px",
                              }}
                            />
                          )}
                          <MenuItem
                            onClick={() => {
                              handleMenuItemClick(item.path, item.label)
                              handleClose()
                            }}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              color: "#FFFFFF",
                              fontSize: "13px",
                              fontWeight: 500,
                              padding: "10px 12px",
                              borderRadius: "10px",
                              mb: 0.4,
                              transition: "background-color .12s ease",
                              "&:hover": {
                                backgroundColor: alpha(ACCENT, 0.1),
                                "& .poppin-glyph": { opacity: 1 },
                              },
                            }}
                          >
                            {item.customComponent || (
                              <>
                                <Box
                                  className="poppin-glyph"
                                  sx={{
                                    width: 20,
                                    display: "grid",
                                    placeItems: "center",
                                    flexShrink: 0,
                                    transition: "opacity .12s ease",
                                  }}
                                >
                                  {item.icon}
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>{item.label}</Box>
                                {item.trailing}
                              </>
                            )}
                          </MenuItem>
                        </Box>
                      ))}
                  </Box>

                  {/* Footer: settings + logout */}
                  <Box
                    sx={{
                      borderTop: `1px solid ${alpha("#FFFFFF", 0.06)}`,
                      pt: 1,
                      mt: 1,
                    }}
                  >
                    {menuItems
                      .filter(
                        (item) =>
                          item.label.toLowerCase().includes("settings") ||
                          item.label.toLowerCase().includes("logout")
                      )
                      .map((item) => {
                        const isLogout = item.label
                          .toLowerCase()
                          .includes("logout")
                        return (
                          <MenuItem
                            key={item.label}
                            onClick={() => {
                              handleMenuItemClick(item.path, item.label)
                              handleClose()
                            }}
                            sx={{
                              color: isLogout
                                ? alpha(JUICE.redSoft, 0.9)
                                : "#FFFFFF",
                              fontSize: "13px",
                              fontWeight: 500,
                              padding: "10px 12px",
                              borderRadius: "10px",
                              mb: 0.4,
                              transition: "background-color .12s ease",
                              "&:hover": {
                                backgroundColor: isLogout
                                  ? alpha(JUICE.redSoft, 0.1)
                                  : alpha(ACCENT, 0.1),
                              },
                            }}
                            style={{ display: "flex", alignItems: "center", gap: "10px" }}
                          >
                            {item.customComponent || (
                              <>
                                <Box
                                  className="poppin-glyph"
                                  sx={{
                                    width: 20,
                                    display: "grid",
                                    placeItems: "center",
                                    flexShrink: 0,
                                    transition: "opacity .12s ease",
                                  }}
                                >
                                  {item.icon}
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>{item.label}</Box>
                              </>
                            )}
                          </MenuItem>
                        )
                      })}
                  </Box>
                </Box>
              </Popover>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  )
}

/**
 * THE SITE'S LIVE PILL — one object, two jobs, and the difference is a prop.
 *
 * WITH `onPress` it is a real <button>: keyboard-activable for free, focus
 * ring included, and its whole 36px height is the target (WCAG 2.2 SC 2.5.8
 * asks for 24x24; this is 36). WITHOUT it, it is a <div> stating a fact, and
 * a fact must not be focusable or announce itself as pressable — that is the
 * exact shape the pill has always had, and it is what ships while site chat
 * is switched off.
 *
 * HOVER PAINTS, HOVER DOES NOT MOVE. The only things the hover block touches
 * are colours: no padding, no border-width, no transform, no font-weight, no
 * gap. A control that resizes under the cursor drags the whole 36px row with
 * it, and this row is four objects wide at a 320px panel.
 *
 * The dot is JUICE.green because green is semantic here and "someone is
 * here" is the one non-money thing it is allowed to mean.
 */
function SiteLivePill({
  label,
  host,
  accent,
  onPress,
}: {
  label: string
  /** Only for the button's accessible name. Absent on the fact variant. */
  host?: string | null
  accent?: string
  onPress?: () => void
}) {
  const pressable = typeof onPress === "function"
  return (
    <Box
      data-presence
      {...(pressable
        ? {
            component: "button" as const,
            type: "button" as const,
            onClick: onPress,
            className: "click-animation",
            "aria-label": host
              ? `${label} — open the live chat for ${host}`
              : `${label} — open the live chat`,
          }
        : {})}
      sx={{
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        px: "12px",
        // A <button> arrives with its own UA padding, font and box model. The
        // height above is the row's, not the browser's, so the box model is
        // pinned here and the vertical padding zeroed: 36px means 36px in both
        // variants, and the pill cannot grow the header row by two pixels the
        // day it becomes a control.
        py: 0,
        boxSizing: "border-box",
        borderRadius: "999px",
        backgroundColor: JUICE.well,
        border: `1px solid ${JUICE.border}`,
        fontFamily: "inherit",
        fontSize: "12px",
        fontWeight: 600,
        color: JUICE.text,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: pressable ? "pointer" : "default",
        transition: "background-color .15s ease, border-color .15s ease",
        ...(pressable
          ? {
              "&:hover": {
                backgroundColor: alpha(accent ?? JUICE.accent, 0.12),
                borderColor: JUICE.borderStrong,
              },
              "&:focus-visible": {
                // An outline is drawn OUTSIDE the box, so the focus ring
                // costs no layout — the row does not shift when a reader
                // tabs onto the pill.
                outline: `2px solid ${accent ?? JUICE.accent}`,
                outlineOffset: "2px",
              },
            }
          : {}),
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          backgroundColor: JUICE.green,
        }}
      />
      {label}
    </Box>
  )
}

// Single pill inside the header tab strip. Visually quiet when inactive,
// pops with brand-blue + contrast text when active. The optional count
// renders as a small middle-dot + compact number (e.g. "Posts · 1.2k").
function HeaderPillTab({
  id,
  active,
  accent,
  label,
  count,
  onClick,
}: {
  id?: string
  active: boolean
  accent: string
  label: string
  count?: number
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <Box
      id={id}
      onClick={onClick}
      className="click-animation"
      sx={{
        flex: 1,
        minWidth: 0,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.6,
        borderRadius: "999px",
        cursor: "pointer",
        // The active tab is the WIDEST object in the header, and painting
        // it solid accent made roughly half the panel's top edge bright
        // blue — the opposite of how poppin.so spends its accent, which is
        // on small objects that GLOW (a button, a keyword) against a dark
        // ground. So: accent as light, not as paint. Tinted glass, accent
        // type, a hairline accent edge and a soft accent halo.
        //
        // The 36px round home/chat buttons keep their solid accent fill on
        // purpose — at that size a filled accent reads as a jewel, and the
        // rule the site actually follows is about AREA, not about colour.
        color: active ? accent : alpha("#FFFFFF", 0.85),
        backgroundColor: active ? alpha(accent, 0.14) : "transparent",
        border: `1px solid ${active ? alpha(accent, 0.4) : "transparent"}`,
        boxShadow: active ? `0 6px 20px -10px ${alpha(accent, 0.9)}` : "none",
        transition:
          "background-color .16s ease-out, color .16s ease-out, box-shadow .16s ease-out",
        "&:hover": {
          backgroundColor: active ? alpha(accent, 0.2) : alpha("#FFFFFF", 0.06),
        },
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
      {count !== undefined && (
        <>
          <Box
            sx={{
              width: 4,
              height: 4,
              borderRadius: "999px",
              backgroundColor: "currentColor",
              opacity: 0.55,
            }}
          />
          <Typography
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              opacity: 0.75,
            }}
          >
            {formatCompactNumber(count)}
          </Typography>
        </>
      )}
    </Box>
  )
}
