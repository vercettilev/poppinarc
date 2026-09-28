/**
 * TWO SENTENCES ON TOP OF THE FIRST REAL CHIP.
 *
 * Onboarding used to explain the product on slides; nobody read them, and
 * the day this was written 87 of 107 installs had never signed in. The
 * replacement explains nothing until there is a real chip on a real page
 * to point at. A one-shot flag says it has not run in this browser; the
 * strip, on the first chip it lands, asks whether this browser has ever
 * been shown it and draws this if not.
 *
 * ONE MESSAGE PER STEP, and only two steps. "Here is the chip" and "here
 * is Buy". Where money comes from is not a lesson: the sheet asks for it
 * at the moment someone taps Buy, which is the only moment it matters.
 *
 * EVERY READER GETS IT ONCE, not only the ones who finished onboarding.
 * See COACH_SEEN_KEY for what that cost and why it changed.
 *
 * INSIDE THE CHIP'S OWN SHADOW ROOT, below the row, not a page overlay.
 * X rebuilds its DOM constantly and recycles cells; anything positioned
 * against the page drifts or lands on the wrong tweet. A card that lives
 * inside the chip moves with the chip and dies with it, which is the
 * only anchoring on X that has ever held.
 *
 * The flag is cleared the moment the coach is shown, not when it is
 * dismissed: a person who scrolls away has still seen it, and a coach
 * that reappears on every chip until acknowledged is a nag.
 */
import { POPPIN_LOGO_URI } from "~/assets/poppinLogoDataUri"
import { COACH_SEEN_KEY } from "~/config/onboarding"

/**
 * Has this browser never been shown the coach? Storage that cannot be read
 * answers NO, because a coach that draws itself whenever storage hiccups
 * is the nag the one-shot exists to prevent — and the reader who loses it
 * to a failed read loses two sentences, while the reader who gets it on
 * every chip loses the feed.
 */
/**
 * WHICH COACH THEY HAVE SEEN, not merely whether they have seen one.
 *
 * The flag used to hold `true`, which answered "has this browser ever been
 * shown a coach" and made every later edit invisible: the 446 readers who
 * already carry the flag would never meet a rewritten card, and neither
 * would anyone who tripped it on a dev build. Bump this number whenever
 * the steps change and every browser is owed exactly one more showing.
 */
export const COACH_VERSION = 2

export async function coachPending(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(COACH_SEEN_KEY)
    const seen = got?.[COACH_SEEN_KEY]
    /* `true` is the v1 flag, written before this was a number. It counts as
       version 1, so those readers are owed this coach and not the last one. */
    const n = seen === true ? 1 : typeof seen === "number" ? seen : 0
    return n < COACH_VERSION
  } catch {
    return false
  }
}

/** Spend it. Called the moment the card is drawn, never on dismissal. */
export async function markCoachSeen(): Promise<void> {
  try {
    await chrome.storage.local.set({ [COACH_SEEN_KEY]: COACH_VERSION })
  } catch {
    // Worst case the next page shows it again, which the old flag risked too.
  }
}

export interface CoachDeps {
  /** The chip host inside the shadow root; the card is appended to it. */
  chip: HTMLElement
  /** Read the one-shot flag. Resolves false when storage is unavailable. */
  pending(): Promise<boolean>
  /** Clear it. */
  clear(): Promise<void>
  /** Telemetry, already wrapped so it cannot throw. */
  track(event: string, payload: Record<string, unknown>): void
}

/* WHAT THE PERSON GAINS, not what the product has. "Works on X, Reddit,
   any site" was a feature list wearing a coach mark; where the product
   works is the sign-in headline's job. Here each sentence names the thing
   that just got easier for them. No "chip" either: it is our word, and a
   first-time visitor can see the thing it names. */
/**
 * FOUR STEPS, AND EACH ONE LIGHTS THE CONTROL IT IS TALKING ABOUT.
 *
 * Two of them exist because three of this row's controls are INVISIBLE at
 * rest: the bell, the wallet and the wordmark sit at `opacity: 0` and
 * `max-width: 0` until a pointer arrives (see xStrip's hover block). Nobody
 * finds those by accident, and measured 2026-09-24 nobody had: two people
 * had ever opened the chart and none the bell. So the card holds the row in
 * its hovered state while it points, and lets go when it is done.
 *
 * `aim` is a selector inside the chip's own shadow root. `null` means the
 * whole row, which is the first step's job: say what this thing is.
 */
/** How long the row takes to open its hidden controls; see JUICE.motionMs. */
const REVEAL_MS = 240

const STEPS: ReadonlyArray<{ text: string; aim: string | null }> = [
  {
    text: "That's Poppin. Buy or sell anything, on any page you read.",
    aim: null,
  },
  { text: "Hover the row to see the chart.", aim: ".more" },
  { text: "Click here to set up notifications.", aim: ".ring" },
  /**
   * THE ONLY PLACE ANYBODY LEARNS THE POINTS EXIST. The leaderboard has
   * been live for days and measured 2026-09-24 nobody had opened it, so
   * "it exists" and "it is known" were different facts.
   *
   * It says TRADES earn, not "you earn", because all three earning verbs
   * need a landed trade (1pt/$1, a fifth of an invitee's volume, and a
   * seat the trade itself opens). A card that promised points without
   * naming the price would be promising something behind the same wall
   * the reader has not crossed yet.
   */
  {
    text: "Your wallet and positions live here. Trades earn points.",
    aim: ".wal",
  },
]

/**
 * THE FACE CHANGES WITH THE SENTENCE. Step one is the brand mark, the
 * blue-ring ghost. Step two is the same ghost in sunglasses, the reward
 * the chip already plays when a trade lands, so the second sentence is
 * delivered by the character the product uses for "you did it". Both are
 * extension files the manifest exposes to every page; the data-URI logo
 * is the fallback for a context with no chrome.runtime (tests).
 */
const faceFor = (step: number): string => {
  const url = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime?.getURL
  if (!url) return POPPIN_LOGO_URI
  return step === 0 ? url("icons/logo.png") : url("pop-reward.webp")
}

export const COACH_STYLE = `
  /* The card speaks the product's own language, and it speaks AS the
     product: the ghost sits where a speaker's face goes, and a small tail
     points up at the chip it is talking about. A correct grey rectangle
     read as a browser tooltip; this reads as Poppin saying something. */
  .coach {
    position: relative;
    margin: 12px 0 2px; margin-left: var(--coach-shift, 0px);
    transition: margin-left .22s cubic-bezier(.16,1,.3,1); padding: 12px 14px 12px 12px;
    display: grid; grid-template-columns: 34px 1fr; column-gap: 11px; align-items: start;
    background: #0E1420; color: #EAF2FB;
    border-radius: 16px; max-width: 340px;
    box-shadow: inset 0 0 0 1px rgba(122,183,255,.26), 0 14px 36px rgba(0,0,0,.5);
    font: 700 15px/1.35 PoppinSans, -apple-system, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -.01em;
    animation: coach-in .42s cubic-bezier(.16,1,.3,1) both;
  }
  /* THE TAIL FOLLOWS THE CONTROL, and the card slides under it. Fixed at
     26px it always pointed at the left end of the row while the words
     named the bell or the wallet, which sit at the far right: the one
     thing on screen that says WHERE was pointing at the wrong place. Both
     offsets are written from script after the reveal has settled; the
     fallbacks here are the first step, which is about the whole row. */
  .coach::before {
    content: ""; position: absolute; left: var(--coach-tail, 26px); top: -7px;
    width: 14px; height: 14px; transform: rotate(45deg);
    background: #0E1420;
    box-shadow: inset 1px 1px 0 0 rgba(122,183,255,.26);
    border-radius: 3px 0 0 0;
  }
  .coach-mark {
    width: 34px; height: 34px; border-radius: 50%; display: block;
    box-shadow: 0 0 0 2px rgba(104,198,255,.35), 0 6px 18px rgba(104,198,255,.35);
    animation: coach-nod .6s .25s cubic-bezier(.16,1,.3,1) both;
  }
  .coach-text { padding-top: 6px; }
  .coach-row { grid-column: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
  .coach-dots { display: flex; gap: 6px; }
  .coach-dots i { width: 6px; height: 6px; border-radius: 999px; background: rgba(122,183,255,.22); display: block; transition: width .2s; }
  .coach-dots i.on { background: #68C6FF; width: 18px; }
  /* THE RING THE CARD IS POINTING AT. One control at a time, and it has to
     outrank the control's own resting look without changing its size: a
     ring that grew the element would shift everything beside it on every
     step, and the row is a flex line. */
  /* LOUD ON PURPOSE. The first version drew a 2px ring that a reader
     scanning a feed could miss entirely, on the one card whose whole job
     is to say LOOK HERE. */
  .coach-aim {
    position: relative; z-index: 3; border-radius: 999px;
    box-shadow: 0 0 0 3px #68C6FF, 0 0 0 7px rgba(104,198,255,.30),
                0 0 26px 2px rgba(104,198,255,.55);
    animation: coach-pulse 1.5s ease-in-out infinite;
  }
  @keyframes coach-pulse {
    0%, 100% { box-shadow: 0 0 0 3px #68C6FF, 0 0 0 7px rgba(104,198,255,.30),
                           0 0 26px 2px rgba(104,198,255,.55); }
    50%      { box-shadow: 0 0 0 3px #68C6FF, 0 0 0 11px rgba(104,198,255,.12),
                           0 0 34px 4px rgba(104,198,255,.70); }
  }
  /* DIM AT THE LEAVES. The first cut dimmed the row's two direct children,
     but the bell, the wallet, Buy and Sell are all siblings inside .end,
     so singling out one of them left the other three at full strength and
     nothing looked chosen. */
  .chip.coach-hold .lead > *:not(.coach-aim),
  .chip.coach-hold .end > *:not(.coach-aim) {
    opacity: .28; transition: opacity .22s ease;
  }
  @media (prefers-reduced-motion: reduce) { .coach-aim { animation: none } }
  .coach-go {
    border: 0; cursor: pointer;
    font: 800 13px/1 PoppinSans, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #68C6FF; color: #06202E; border-radius: 999px; padding: 10px 18px;
    box-shadow: 0 6px 18px rgba(104,198,255,.35);
    transition: transform .12s, background .12s, box-shadow .12s;
  }
  .coach-go:hover { background: #8AD4FF; box-shadow: 0 8px 22px rgba(104,198,255,.45); }
  .coach-go:active { transform: translateY(1px) scale(.98); }
  /* The chip the card is talking about lights up twice as the card lands,
     so the eye goes chip, then card, in that order. */
  .chip.coach-glow .row { border-radius: 999px; animation: coach-ring 1.6s .1s ease-out 2; }
  @keyframes coach-ring {
    0%   { box-shadow: 0 0 0 0 rgba(104,198,255,.55); }
    70%  { box-shadow: 0 0 0 10px rgba(104,198,255,0); }
    100% { box-shadow: 0 0 0 0 rgba(104,198,255,0); }
  }
  @keyframes coach-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
  @keyframes coach-nod { from { transform: translateY(4px) rotate(-8deg); opacity: 0 } to { transform: none; opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .coach, .coach-mark, .chip.coach-glow .row { animation: none } }
`

/** Idempotent per page: the strip calls this on every landing, it acts once. */
let claimed = false

export async function maybeCoach(deps: CoachDeps): Promise<void> {
  if (claimed) return
  claimed = true
  let show = false
  try {
    show = await deps.pending()
  } catch {
    show = false
  }
  if (!show) {
    claimed = false
    return
  }
  /**
   * CONNECTED FIRST, CLEARED SECOND, AND THE CLAIM GOES BACK ON EVERY BAIL.
   *
   * These three lines used to run the other way round and the coach then
   * appeared on some runs and not others, with nothing in between to
   * explain it. The strip calls this on EVERY chip that lands, and x.com
   * recycles timeline cells constantly — this repo's own notes call cell
   * recycling the chip's main hazard. So the first chip to call would take
   * the claim, go away to read storage, have its cell recycled while the
   * read was in flight, CLEAR the pending flag, and only then notice it was
   * no longer on the page and return. The flag was spent, `claimed` stayed
   * true for the life of the content script, and the coach was gone: not
   * for that chip, for that reader, forever.
   *
   * Asking whether the chip is still there before spending the flag makes
   * the loss impossible, and releasing the claim hands the turn to the next
   * chip that lands — which on a timeline is a fraction of a second away.
   */
  if (!deps.chip.isConnected) {
    claimed = false
    return
  }
  try {
    await deps.clear()
  } catch {
    // Worst case the next page shows it again; better than never.
  }
  // Between the check above and here is one storage write. Cheap, but not
  // free, and the card is about to be built against this node.
  if (!deps.chip.isConnected) {
    claimed = false
    return
  }

  let step = 0
  const card = document.createElement("div")
  card.className = "coach"
  card.setAttribute("role", "status")

  /**
   * HOLD THE ROW OPEN WHILE POINTING, and let go afterwards. Steps two
   * through four name controls the reader cannot see until a pointer
   * arrives, so the card fakes that pointer with a class and the row keeps
   * its own hover rules. `coach-hold` is declared beside those rules in
   * xStrip, not here, because a later sheet of equal specificity would
   * otherwise win and the reveal would silently stop working.
   */
  let aimed: Element | null = null
  let placeT: ReturnType<typeof setTimeout> | null = null

  /**
   * PUT THE CARD UNDER WHAT IT IS NAMING.
   *
   * The card is 340px on a row that can be twice that, and its tail was
   * pinned to the left end. So while the words said "the bell" the only
   * thing on screen that points was aimed at the asset disc, at the other
   * end of the row. Now the card slides along the row and the tail lands
   * on the control's centre.
   *
   * MEASURED AFTER THE REVEAL, not during it. The bell and the wallet
   * animate open from max-width 0 over 240ms; a rect read while that is
   * running returns a control half its final width and the tail lands
   * beside it rather than on it.
   *
   * This is the one place in this file that forces layout, once per step
   * on one card, which is nothing like the per-cell thrash xStrip batches
   * away.
   */
  const place = () => {
    if (!aimed || !card.isConnected) return
    const chipBox = deps.chip.getBoundingClientRect()
    const aimBox = aimed.getBoundingClientRect()
    if (!aimBox.width) return
    const cardW = card.getBoundingClientRect().width || 340
    const centre = aimBox.left + aimBox.width / 2 - chipBox.left
    /* Clamped to the row: a card that hangs off either edge is worse than
       a tail that stops short of the control. */
    const shift = Math.max(0, Math.min(centre - cardW / 2, chipBox.width - cardW))
    card.style.setProperty("--coach-shift", `${Math.round(shift)}px`)
    /* And the tail, inside the card, on the control's centre. Kept off the
       rounded corners so it never grows out of a curve. */
    const tail = Math.max(14, Math.min(centre - shift - 7, cardW - 28))
    card.style.setProperty("--coach-tail", `${Math.round(tail)}px`)
  }

  const aimAt = (sel: string | null) => {
    if (placeT) clearTimeout(placeT)
    aimed?.classList.remove("coach-aim")
    aimed = null
    deps.chip.classList.toggle("coach-hold", sel !== null)
    deps.chip.classList.toggle("coach-glow", sel === null)
    if (!sel) {
      card.style.removeProperty("--coach-shift")
      card.style.removeProperty("--coach-tail")
      return
    }
    /* Missing is fine and must stay silent: the wallet is absent for a
       signed-out reader, and a step that cannot point still has words. */
    aimed = deps.chip.querySelector(sel)
    if (!aimed) {
      card.style.removeProperty("--coach-shift")
      card.style.removeProperty("--coach-tail")
      return
    }
    aimed.classList.add("coach-aim")
    placeT = setTimeout(place, REVEAL_MS + 30)
  }
  const release = () => {
    if (placeT) clearTimeout(placeT)
    aimAt(null)
    deps.chip.classList.remove("coach-glow", "coach-hold")
  }

  const paint = () => {
    card.innerHTML = ""
    const mark = document.createElement("img")
    mark.className = "coach-mark"
    mark.src = faceFor(step)
    mark.alt = ""
    const text = document.createElement("div")
    text.className = "coach-text"
    text.textContent = STEPS[step]!.text
    card.append(mark, text)
    const row = document.createElement("div")
    row.className = "coach-row"
    const dots = document.createElement("span")
    dots.className = "coach-dots"
    STEPS.forEach((_, i) => {
      const d = document.createElement("i")
      if (i === step) d.className = "on"
      dots.appendChild(d)
    })
    const go = document.createElement("button")
    go.className = "coach-go"
    go.textContent = step === STEPS.length - 1 ? "Got it" : "Next"
    go.addEventListener("click", (e) => {
      e.stopPropagation()
      deps.track("x_coach", { step: step + 1, action: step === STEPS.length - 1 ? "done" : "next" })
      step += 1
      if (step >= STEPS.length) {
        card.remove()
        release()
        return
      }
      paint()
    })
    row.append(dots, go)
    card.appendChild(row)
    aimAt(STEPS[step]!.aim)
  }

  paint()
  deps.chip.appendChild(card)
  deps.track("x_coach", { step: 1, action: "shown" })
}
