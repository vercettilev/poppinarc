/**
 * THE POPPIN DESIGN LANGUAGE — "juice", one source of truth.
 *
 * The product read as a TOOL because every surface wore X's own neutrals:
 * #16181c grounds, gray-scale labels, hairline white borders. Perfect
 * camouflage, zero identity. The verdict that created this file: "UÇTAN UCA
 * bir marka gibi görünmeli. juicy görünmeli... bir tool gibi değil."
 *
 * The language, in six rules:
 *
 *   1. BLUE-BLACK GROUND, never X-gray. Every Poppin surface sits on a
 *      navy-tinted black with a brand-tinted border. You can tell a Poppin
 *      pixel from an X pixel at a glance.
 *   2. GRAYS ARE BLUE. There is no neutral gray in this product; every
 *      secondary text color carries the brand's temperature.
 *   3. THE GLOW IS THE SIGNATURE. Things that can move money glow, softly
 *      at rest and loudly at the moment of success. Poppin = pop.
 *   4. GREEN AND RED STAY SEMANTIC and never decorate. Up/down, buy/sell
 *      profit/loss — nothing else.
 *   5. NUMBERS ARE THE HEROES. Money renders big, heavy, tabular.
 *   6. THE DATA SPEAKS MONO; the chrome never does. Prices, percentages,
 *      balances, addresses, chart axes and order tags wear `mono` — the
 *      terminal voice is the cyberpunk dose ("Fomo x Apple x Cyberpunk"),
 *      and it lives ONLY in the data. Names, labels and sentences stay in
 *      the product face. No glitch effects, no HUD brackets, no uppercase
 *      tech labels, ever: the dose is texture, not costume.
 *   7. ONE MOVEMENT, ONE TIMING. Animations that describe the SAME
 *      movement — a panel opening, and the radius and content that ride
 *      it — share `motionMs` and `motionEase`, and nothing describes a
 *      movement twice (a box that grows is never also translated).
 *      Different objects may still move at different speeds: a press is
 *      quicker than an opening, and that is hierarchy, not drift.
 *
 * Every surface imports THESE tokens; a hex literal outside this file is a
 * bug waiting to drift.
 */

/** Grounds — navy-black, not gray-black. */
export const JUICE = {
  /** The chip/card surface. */
  ground: "#0E1420",
  /** The page canvas one step BELOW `ground` — panel body, page backdrops. */
  groundDeep: "#090E17",
  /** A slightly lifted well (inputs, chart plot). */
  well: "rgba(122,183,255,.05)",
  /** Opaque raised fill for controls that need a solid surface (the panel's
   *  secondary buttons, org-overridable). `well` with the alpha baked in. */
  wellSolid: "#1B2534",
  /** The brand-tinted hairline every Poppin surface wears. */
  border: "rgba(122,183,255,.17)",
  /** Stronger border for focus/hover. */
  borderStrong: "rgba(122,183,255,.38)",

  /** Brand accent family. */
  accent: "#68C6FF",
  accentHi: "#8AD4FF",
  accentDeep: "#5EC1FF",
  /** Text on accent fills. */
  onAccent: "#06202E",
  /** Accent as INK — the readable light blue for text and small glyphs on a
   *  dark ground, as opposed to `accent` which is a fill. It was written as
   *  a bare #9FD9FF in half a dozen places before it had a name. */
  accentInk: "#9FD9FF",

  /** Type — near-white, then BLUE grays, never neutral ones. */
  text: "#EAF2FB",
  text2: "#8CA3BD",
  /** 4.83:1 on `ground` — the first draft (#6E7E93) sat at 4.45, five
   *  hundredths under AA. The contrast spec caught it; the eye had not. */
  text3: "#74849A",

  /** Semantic, unchanged product-wide. */
  green: "#30D158",
  red: "#FF453A",
  redSoft: "#FF6B61",
  amber: "#F5A524",

  /** The data voice (rule 6). System mono everywhere so nothing is bundled;
   *  ui-monospace resolves to SF Mono on Apple and the platform's best
   *  elsewhere. Pair with letter-spacing -.01em: mono runs wide. */
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  /** The weak cyan halo a LIVE number carries — the price that ticks. Text
   *  only, one element per surface; a halo on everything is a halo on
   *  nothing. */
  neonText: "0 0 9px rgba(104,198,255,.38)",

  /** The resting glow every money surface carries. */
  glowRest: "0 4px 28px -10px rgba(104,198,255,.42)",
  /** The success glow (paired with the glow-ok beat). */
  glowPop: "0 0 26px -4px rgba(48,209,88,.5)",
  /** The opening beat (rule 7): one duration and one curve for every
   *  animation that rides a surface opening. Measured cause of
   *  "animasyonlarda kopukluk" on the feed: the sheet's height ran 240ms,
   *  the chip's radius 280ms and the content's fade 300ms, so one movement
   *  finished three times. The curve is a decelerate: fast out of the
   *  gate, gentle at rest. */
  motionMs: 240,
  motionEase: "cubic-bezier(.16, 1, .3, 1)",

  /**
   * THE CEREMONY TIER, and the rule that keeps it from eating the product.
   *
   * Rule 7 says one movement, one timing. It does NOT say one timing for
   * everything: "a press is quicker than an opening, and that is hierarchy,
   * not drift". This is the slowest rung of that hierarchy and it is spent
   * on the moments that are RARE AND CONSEQUENTIAL — a trade landing, a
   * chart opening to full screen, a chip arriving on a tweet, the ceremonies
   * an install sees once.
   *
   * Where it must never go, because these are either an answer to a finger
   * or a thing that repeats:
   *   - the press itself (pressMs, 60ms — anything slower reads as the
   *     surface thinking about it)
   *   - the live price tick, which fires more often than this lasts
   *   - the chart's range buttons, which are a COMPARISON gesture: somebody
   *     taps through them to compare, and a ceremony per tap makes the
   *     comparison impossible
   *   - scrubbing, quote-while-typing, hovers, and every error message,
   *     which the reader needs NOW
   *   - long list staggers, where this multiplied by ten rows is seconds
   *
   * Navigation between panel screens sits between the tiers: same curve,
   * half the weight, because it repeats.
   *
   * INTERRUPTIBLE OR IT IS NOT PREMIUM. Nothing on this tier may queue: a
   * second press during the ceremony jumps to the end state rather than
   * waiting its turn.
   */
  /**
   * A DRAW IS A PEN, NOT AN ENTRANCE.
   *
   * cinemaEase is a hard decelerate: it covers most of its distance in the
   * first fifth of the time, which is right for something ARRIVING and
   * wrong for something being DRAWN. Reported on the chart line as "not
   * uniform, it leaps": a pen that crosses ninety percent of the plot in
   * the first fifth of a second is not gliding, it is lunging, and then it
   * crawls through the part the eye is actually following.
   *
   * The first control point sits ON the diagonal, so the first half runs at
   * constant speed — the uniformity that was asked for. The second lifts
   * the tail so the line settles rather than stopping dead against the
   * right edge. Same family as the rest of the language, different job.
   */
  drawEase: "cubic-bezier(.33, .33, .68, 1)",

  cinemaMs: 720,
  cinemaNavMs: 420,
  cinemaEase: "cubic-bezier(.12, .9, .2, 1)",

  /**
   * THE PRESS — the part a physical switch has and a cheap surface fakes.
   *
   * A press must ARRIVE faster than it LEAVES. The finger's own movement is
   * instant, so anything slower than about 70ms reads as the surface
   * thinking about it; the release is where the springiness lives, and a
   * touch of overshoot there is the difference between a button and a
   * rectangle. These are the only two durations on this axis, and controls
   * compose them through custom properties rather than overriding each
   * other's `transform` — hover LIFTS, press SCALES, and a control that
   * does both does both.
   */
  /**
   * THE MONEY BUTTON'S OWN GREEN, and why it is not the accent.
   *
   * Buy was brand blue for a long time on the argument that green is
   * already semantic here — it means "the number went up" and "your money
   * landed". That argument was weaker than it looked: Robinhood, Coinbase,
   * Binance and every Solana terminal use green for buy AND green for up,
   * and nobody confuses them, because a percentage is a percentage and a
   * button is a button. What decides it is RECOGNITION WITHOUT READING: a
   * reader moving fast does not read "Buy $25", they see a green pill and
   * know.
   *
   * The collision is avoided by TREATMENT, not by hue. The button is a
   * filled green; the price's verdict stays green TEXT on a tint. Fill and
   * text are far enough apart that two greens on one 36px row never blur.
   */
  /**
   * Both directions, and neither of them shouts.
   *
   * A saturated green key was the right answer for recognition and the
   * wrong one for the place this lives: the chip sits in somebody's
   * timeline all day, and a filled traffic-light on every scroll is
   * intrusive however good it looks in isolation. The pair keeps the
   * colours — green in, red out, read without reading — and drops the
   * FILL: a tinted ground and coloured ink carry the same meaning at a
   * tenth of the volume, and they let Buy and Sell sit at the same
   * hierarchy, which is what they actually are.
   *
   * Saturation arrives on hover, when somebody has aimed at one of them.
   */
  buyInk: "#4ADE80",
  buyGround: "rgba(48,209,88,.10)",
  buyEdge: "rgba(48,209,88,.24)",
  sellInk: "#FF7A70",
  sellGround: "rgba(255,69,58,.09)",
  sellEdge: "rgba(255,69,58,.22)",

  pressMs: 60,
  releaseMs: 180,
  releaseEase: "cubic-bezier(.2, 1.35, .4, 1)",
  /** How far a pressed control gives. Small: this is a pill, not a key. */
  pressScale: 0.95,

  /** The money button, rest and hover: the brightest object on any surface.
   *  Includes its own inner highlight so all three surfaces share one
   *  recipe end to end.
   *
   *  THE HUE COMES FROM THE BUTTON, THE RECIPE FROM HERE. A buy confirm is
   *  green, a sell confirm is red and a funding button is brand blue, and
   *  before this the halo was blue under all three because the colour was
   *  baked into the recipe. Composing through a custom property is the same
   *  move --lift and --press already make in the chip: one rule, and the
   *  thing that varies supplies its own value. Surfaces that set nothing
   *  keep exactly what they had. */
  glowMoney:
    "inset 0 1px 0 rgba(255,255,255,.35), 0 6px 26px -5px var(--money-glow, rgba(104,198,255,.78))",
  glowMoneyHover:
    "inset 0 1px 0 rgba(255,255,255,.4), 0 7px 30px -5px var(--money-glow-hi, rgba(104,198,255,.9))",

  /** THE TWO FILLED DIRECTIONS. The row settled this: green in, red out,
   *  and the sheet has to agree with the row it opened from. The red pair
   *  was already here as loose literals in xStrip; it is a token now so the
   *  two directions are declared in one place and cannot drift apart. */
  buyFillHi: "#5BE58F",
  buyFillDeep: "#22C55E",
  onBuyFill: "#04240F",
  buyGlow: "rgba(48,209,88,.66)",
  buyGlowHi: "rgba(48,209,88,.8)",
  sellFillHi: "#FF7A70",
  sellFillDeep: "#F5453A",
  onSellFill: "#2B0705",
  sellGlow: "rgba(255,69,58,.55)",
  sellGlowHi: "rgba(255,69,58,.7)",
} as const

/** The one gradient: active fills and primary buttons that are not a
 *  direction. Funding is the case that keeps it: adding money to a wallet
 *  is not a buy and must never wear the colour that means one. */
export const JUICE_GRADIENT = `linear-gradient(180deg, ${JUICE.accentHi}, ${JUICE.accentDeep})`

/** The same gradient, pointed. One per direction, nothing else. */
export const JUICE_BUY_FILL = `linear-gradient(180deg, ${JUICE.buyFillHi}, ${JUICE.buyFillDeep})`
export const JUICE_SELL_FILL = `linear-gradient(180deg, ${JUICE.sellFillHi}, ${JUICE.sellFillDeep})`

/** Surface sheen: a breath of light at the top of every raised surface. */
export const JUICE_SHEEN =
  "linear-gradient(180deg, rgba(138,212,255,.07) 0%, rgba(138,212,255,0) 55%)"

/** The dotted market grid a chart plot wears — trading-desk texture. */
export const JUICE_GRID =
  "radial-gradient(rgba(122,183,255,.13) 1px, transparent 1px)"

/** Faint horizontal scanlines layered OVER the dot grid on real chart
 *  plots (not sparklines — at sparkline size texture is noise). The
 *  second half of the terminal texture. */
export const JUICE_SCAN =
  "repeating-linear-gradient(180deg, rgba(122,183,255,.05) 0, rgba(122,183,255,.05) 1px, transparent 1px, transparent 7px)"
