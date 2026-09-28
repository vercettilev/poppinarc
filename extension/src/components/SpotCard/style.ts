/**
 * The card's entire stylesheet, injected into a CLOSED shadow root.
 *
 * The type scale is 10/11/12/13/15/21, plus the amount hero which the
 * component sizes inline (40 → 33 → 26 as digits grow, Cash App's move).
 * Spacing runs on a 2px grid; surfaces are low-alpha TINTS OF THE TEXT
 * COLOUR rather than independent greys, so everything sits on one axis.
 *
 * What deliberately did NOT come across: brand.ts, the theme system, publisher
 * theming, font resolution. Those exist so a publisher can recolour an embed.
 * This card is anchored to a page it does not belong to and has no publisher,
 * so they would be machinery with one caller and one value. Plain constants.
 *
 * `:host { all: initial }` is the isolation. Every property inherited from the
 * host page is reset at the boundary before anything below applies — see
 * spot-card.isolation.spec.ts, which renders this inside a page whose CSS is
 * actively hostile and asserts none of it lands.
 */
import { JUICE, JUICE_BUY_FILL, JUICE_SELL_FILL } from "../../theme/juice"

export const SPOT_CARD_STYLE = `
:host { all: initial; }

/* ── POPPIN visual language ─────────────────────────────────────────────────
   The FOMO structure — near-black ground, one filled accent, dot states, the
   amount as the largest element — recoloured to the product's own palette.
   Accent is ${JUICE.accent} with #07070A on top of it: a light accent needs dark
   text, and brand.ts had already decided that pairing. Nothing here invents
   a colour. Up/down/wait are Apple's dark-mode system colours (${JUICE.green},
   ${JUICE.red}, ${JUICE.amber}) — one green, one red, one amber, each with one job.

   THE NUMBER LEADS. The price is the largest thing on the collapsed card and
   the typed amount is the largest thing on the panel — a trading surface
   whose headline is a word reads as a directory entry, and this one's
   headline is the market.

   GLOW IS RATIONED. One bloom on the card, one on the button a press would
   spend money through, nothing else. The earlier pass lit every pill and the
   card read as signage; light only means anything when most things don't.

   Type is PoppinSans (loaded in mount.tsx — see the note there on why a
   @font-face in this file would be silently ignored), falling back to the
   system stack when a page's CSP refuses an extension font.

   MOTION: an arrival, state transitions, a press, and one earned success
   moment. Nothing loops except the idle drift — which freezes the moment a
   cursor arrives or a panel opens, because a target must not move while
   someone is aiming at it — and everything collapses to nothing under
   prefers-reduced-motion. */

/* ── WHY THERE IS NO LOOP HERE ──────────────────────────────────────────────
   The card used to orbit forever: a slow 3px circle, running on a timer.
   Two things were wrong with it, and they are the same thing twice.

   It moved the target. Buy is a pill on somebody else's page and it was
   never once holding still, so you aim at a button that is drifting away
   from the cursor. Pausing on hover treated the symptom and kept the cause.

   And it said "look at me" on a schedule, forever, with nothing behind it.
   Motion is a claim that something happened; a claim that repeats whether or
   not anything happened is noise, and a person filters it out in about a
   day — which costs the one moment when something DID happen and the card
   needed to say so. That is also the whole argument against a recurring
   shake: it spends the attention it is trying to bank.

   So motion is rationed to events, and there are exactly three:

     spot-arrive   the card lands. Once, on mount — this IS the notification
                   beat, and an entrance is allowed to be seen.
     spot-nudge    a voice arrives on the page while the card is closed.
                   Once per arrival, and it carries information: the twitch
                   means somebody spoke, so it stays worth a glance.
     spot-ck-*     a fill confirms. Once, after a decision already made.

   Nothing else moves. Live-ness here is carried by what CHANGES — the price,
   "4 online", a new name in the feed — which is where the pull actually
   comes from. The container wobbling was never it.

   translateY(-50%) is repeated in EVERY keyframe on purpose: the wrap uses
   it for vertical centering, and a keyframe that omits it would drop the
   card half its height mid-animation. */

/* In from the docked edge, decelerating hard and late so it reads as weight
   rather than speed, then one small damped settle — it lands like a thing
   with mass instead of sliding to a stop. */
@keyframes spot-arrive {
  0%   { opacity: 0; transform: translateY(-50%) translateX(30px) scale(.97); }
  70%  { opacity: 1; transform: translateY(-50%) translateX(-3px) scale(1.005); }
  100% { opacity: 1; transform: translateY(-50%) translateX(0) scale(1); }
}
/* Out the way it came, faster than it arrived. An exit is confirmation of
   something the reader just asked for, and confirmation should not be
   savoured — arrivals get to be seen, departures get out of the way.
   Before this existed the card vanished between frames, which reads as a
   crash rather than a close, and made collapsing look like two unrelated
   objects swapping instead of one object moving to the edge. */
@keyframes spot-leave {
  from { opacity: 1; transform: translateY(-50%) translateX(0) scale(1); }
  to   { opacity: 0; transform: translateY(-50%) translateX(26px) scale(.97); }
}
.wrap.leaving { animation: spot-leave 160ms cubic-bezier(.4,0,1,1) both; }
/* Somebody just spoke. A short lean toward the reader and back: no rotation
   and no jitter, because those read as an error shake, and a new voice is
   not an error. */
@keyframes spot-nudge {
  0%   { transform: translateY(-50%) translateX(0); }
  22%  { transform: translateY(-50%) translateX(-7px); }
  48%  { transform: translateY(-50%) translateX(3px); }
  74%  { transform: translateY(-50%) translateX(-2px); }
  100% { transform: translateY(-50%) translateX(0); }
}
.wrap.nudge { animation: spot-nudge 560ms cubic-bezier(.34,1.2,.64,1) both; }
/* Content settles a beat after the card lands, so the eye reads surface first
   and numbers second. One 8px rise, staggered — not a per-element show. */
@keyframes spot-settle {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.wrap {
  /* Docked at the right edge, vertical center — where the old notification sat. Left corners rounded, edge corners squared. */
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  z-index: 2147483647;
  font: 13px/1.45 PoppinSans, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  /* The landing's material: deep blue-black sweeping corner to corner, two
     accent auroras riding on it. Owner-approved ground; unchanged. */
  background:
    radial-gradient(130% 90% at 100% 0%, rgba(104,198,255,.18) 0%, rgba(104,198,255,0) 52%),
    radial-gradient(110% 80% at 0% 100%, rgba(104,198,255,.10) 0%, rgba(104,198,255,0) 48%),
    linear-gradient(150deg, #101B2C 0%, #0A0D14 46%, #0C1626 100%);
  color: #FFFFFF;
  /* Apple's dark material, not a neon frame: a hairline with a WHISPER of the
     accent in it, an inset top highlight (the light source), two depth
     shadows, and one restrained bloom. The .32-alpha border + 52px glow of
     the earlier pass made the frame compete with the CTA. */
  border: 1px solid rgba(122,201,255,.20); border-right: 0;
  border-radius: 18px 0 0 18px;
  /* THE SIGNATURE. Everything else that says "Poppin" on this card is
     conditional on the day: the sparkline and the chip are red when the
     asset is down, which is exactly when a card docked beside a red page
     chart stops looking like ours. This rail is the one accent that is
     always there and never encodes data — 2px on the leading edge, the
     first thing that crosses into the reader's eye as the card arrives.

     An inset shadow rather than a thicker border-left: it follows the
     18px radius exactly, where mixing a 2px left with a 1px top tapers
     the corner join. And it is a RAIL, not a glow — the bloom below is
     still the card's only one, per the rationing rule above. */
  box-shadow: inset 2px 0 0 rgba(104,198,255,.5),
    inset 0 1px 0 rgba(255,255,255,.05),
    0 2px 8px rgba(0,0,0,.35), 0 18px 48px rgba(0,0,0,.5),
    0 0 44px -10px rgba(104,198,255,.38);
  padding: 18px 18px 12px; width: 344px;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
  animation: spot-arrive 220ms cubic-bezier(.16,1,.3,1) both;
}

/* ── The collapsed state: a tab on the page's edge ──────────────────────────
   Same material as the card and the same accent rail, at a size that cannot
   collide with anything: this has to read as the card folded up, not as a
   second widget. 34x48 is a comfortable target without being a banner.

   NOTHING HERE LOOPS. The tab moves when a voice arrives on the page and at
   no other time — see the note above spot-nudge. A permanent element that
   breathes on a timer is the orbit this card already removed once. */
@keyframes spot-pill-in {
  from { opacity: 0; transform: translateY(-50%) translateX(16px); }
  to   { opacity: 1; transform: translateY(-50%) translateX(0); }
}
/* A lean toward the reader and back. Same gesture as the card's nudge, at
   the tab's smaller scale, and it carries the same one meaning: somebody
   spoke on this page. */
@keyframes spot-pill-nudge {
  0%   { transform: translateY(-50%) translateX(0); }
  26%  { transform: translateY(-50%) translateX(-5px); }
  56%  { transform: translateY(-50%) translateX(2px); }
  100% { transform: translateY(-50%) translateX(0); }
}
.pill {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  z-index: 2147483647;
  width: 34px; height: 48px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(104,198,255,.18) 0%, rgba(104,198,255,0) 55%),
    linear-gradient(150deg, #101B2C 0%, #0A0D14 46%, #0C1626 100%);
  border: 1px solid rgba(122,201,255,.20); border-right: 0;
  border-radius: 14px 0 0 14px;
  box-shadow: inset 2px 0 0 rgba(104,198,255,.5),
    inset 0 1px 0 rgba(255,255,255,.05),
    0 2px 8px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.45);
  cursor: pointer;
  /* No position declaration needed for the marks inside: this is already
     position:fixed, which makes it their containing block. */
  animation: spot-pill-in 200ms cubic-bezier(.16,1,.3,1) both;
  transition: width 260ms cubic-bezier(.16,1,.3,1), opacity 260ms ease-out,
    border-radius 260ms ease-out, background-color 200ms ease-out,
    box-shadow 260ms ease-out;
}
.pill.pill-nudge { animation: spot-pill-nudge 520ms cubic-bezier(.34,1.2,.64,1) both; }
/* The logo fades slightly faster than the tab narrows, so the two marks
   cross-fade rather than the logo being squeezed by the shrinking width. */
.pill .mark {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  transition: opacity 140ms ease-out;
}

/* ── The resting mark: a chevron, not a logo ────────────────────────────────
   THE TAB ARRIVES AS ITSELF AND RESTS AS A HANDLE. Relevance earns the
   entrance — a page you can actually trade on is worth one animated arrival
   — but it does not earn a permanent logo. So a few seconds later the tab
   narrows to 14px and swaps the mark for a left-pointing chevron.

   The swap is the whole idea, and it is not a size tweak. A logo is a claim
   about who we are; a chevron is an instruction about what this does. On
   somebody else's page, only the second one has earned a permanent place.
   A dimmed logo is still a logo, and an earlier pass simply slid the pill
   28 of its 34 pixels off-screen — which left a cropped edge, an accident
   rather than a design. This is drawn on purpose.

   It stays ON screen, narrow, rather than hiding off it: a handle you can
   see is a handle you can use, and the tab keeps its full height so the
   band a cursor sweeps into never changes. Flush to the screen edge, it is
   also a Fitts's-law freebie — you throw the pointer at it, you do not aim.

   Transitions, not animations: state changes, once, in one direction.
   Nothing loops, per the rule at the top of this file. */
.pill.pill-rest {
  width: 14px;
  border-radius: 8px 0 0 8px;
  opacity: .72;
  background: linear-gradient(150deg, #0E1826 0%, #0A0D14 60%, #0C1626 100%);
  box-shadow: inset 2px 0 0 rgba(104,198,255,.5);
  border-color: transparent;
}
.pill-tick {
  font-size: 11px; font-weight: 800; letter-spacing: .01em;
  color: #EAF0F7; white-space: nowrap;
  transition: opacity .25s ease;
}
.pill.pill-rest .pill-tick { opacity: 0; width: 0; overflow: hidden; }
.pill.pill-rest .mark { opacity: 0; }
.pill.pill-rest .pill-chevron { opacity: .8; }

/* Absolutely positioned and centred by hand: the pill is a flex row, and a
   flex child cannot be swapped for another without one of them reserving
   width. Taking both out of flow lets the tab narrow to 14px cleanly and
   lets the two marks cross-fade in the same place. */
.pill-chevron {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  color: #9FD9FF;
  opacity: 0;
  transition: opacity 160ms ease-out;
  pointer-events: none;
}

/* ── Hover restores the tab completely ──────────────────────────────────────
   Equal specificity to .pill-rest, so these MUST come after it. Every
   property .pill-rest changed is named again here: a hover that widened the
   tab but left the logo hidden and the chevron showing would be a control
   that grows without telling you what it became. */
.pill:hover, .pill.pill-rest:hover {
  width: 40px;
  border-radius: 14px 0 0 14px;
  transform: translateY(-50%) translateX(0);
  opacity: 1;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(104,198,255,.26) 0%, rgba(104,198,255,0) 55%),
    linear-gradient(150deg, #142236 0%, #0A0D14 46%, #0C1626 100%);
  border-color: rgba(122,201,255,.20);
  box-shadow: inset 2px 0 0 rgba(104,198,255,.5),
    inset 0 1px 0 rgba(255,255,255,.05),
    0 2px 8px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.45);
}
.pill.pill-rest:hover .mark { opacity: 1; }
.pill:hover .pill-chevron, .pill.pill-rest:hover .pill-chevron { opacity: 0; }

/* A voice arriving overrides the resting mark entirely — the tab comes back
   as itself, because "somebody spoke" is news and a handle cannot say it. */
.pill.pill-nudge { opacity: 1; }
.pill-badge {
  position: absolute; top: 6px; right: 4px;
  min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 999px; background: ${JUICE.accent}; color: ${JUICE.onAccent};
  font-size: 9px; font-weight: 700; line-height: 13px; text-align: center;
}
.wrap *, .wrap *::before, .wrap *::after { box-sizing: border-box; }

.head  { animation: spot-settle 320ms cubic-bezier(.16,1,.3,1) 120ms both; }
.acts  { animation: spot-settle 320ms cubic-bezier(.16,1,.3,1) 190ms both; }
.brand { animation: spot-settle 320ms cubic-bezier(.16,1,.3,1) 260ms both; }

/* Keyboard users get the same accent everyone else gets. :focus-visible so a
   mouse press does not carry a ring around. */
:focus-visible { outline: 2px solid rgba(104,198,255,.65); outline-offset: 2px; }

/* ── The navigation bar: ← top-left, × top-right ────────────────────────────
   TWO BUGS DIED HERE, and they had one cause worth writing down.

   .x sat at top:6/right:7 and rendered 24px INSIDE the card, on top of the
   price — because an inner wrapper was carrying the orbit's transform, and a
   transformed element becomes the containing block for absolutely positioned
   descendants. So the offsets were measured from inside the wrap's padding
   instead of from the card's corner. Nothing between .wrap and these buttons
   transforms any more, so the fixed-position .wrap is the containing block
   and these offsets mean what they say.

   Worse, the × DID NOT CLICK. .head animates a transform (spot-settle,
   fill-mode both), which makes it a stacking context, and it comes AFTER
   .x in the DOM — so it painted over the button and swallowed every press
   on it. z-index is not decoration here: it is the fix. Anything positioned
   in these corners needs it for the same reason.

   36x36 hit targets: these are the two controls a person reaches for when
   they want out, and hunting for the exit is the worst possible time to
   make someone aim.

   Both hovers are double-classed (.wrap .x) to outrank the filled-accent
   base button rule — an exit that lights up blue like Buy is the way out
   dressed as the way in. Same story for every quiet control below. */
.x, .nav-back {
  position: absolute; top: 8px; z-index: 3;
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 999px; background: none;
  color: rgba(255,255,255,.42); line-height: 1; cursor: pointer;
  box-shadow: none;
  transition: color 150ms ease-out, background-color 150ms ease-out;
}
.x { right: 8px; }
.nav-back { left: 8px; }
.wrap .x:hover, .wrap .nav-back:hover {
  color: #FFFFFF; background: rgba(255,255,255,.09);
}
/* The head keeps clear of the ← too, but only in the views that have one. */
.head-inset { padding-left: 26px; }

/* ── Collapsed head: identity left, market right ────────────────────────────
   The price is the biggest type on the collapsed card — bigger than the
   name. The name is recognition ("this page has a tradeable thing"); the
   price is the story. The 24h move is a TINTED CHIP, not glowing text: a
   chip reads as a fact at a glance, and text-shadow on numbers is the
   costume version of it. */
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-right: 30px; }
.col-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.col-num { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.name {
  font-size: 15px; font-weight: 700; letter-spacing: -.01em; color: #FFFFFF;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.subrow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ticker {
  font-size: 11px; font-weight: 600; letter-spacing: .05em;
  color: rgba(255,255,255,.42);
}
.price {
  font-size: 21px; font-weight: 700; line-height: 1; letter-spacing: -.01em;
  color: #FFFFFF; font-variant-numeric: tabular-nums;
  text-shadow: ${JUICE.neonText};
  transition: color 550ms ease-out;
}
/* The tick's own flash — a fourth legitimate motion event alongside arrive,
   nudge and the success check. Colour only, on the number that changed, and
   it RELAXES via the transition above rather than animating in: an abrupt
   flash-then-cut reads as an error state, a fade back to white reads as
   "that just happened, and now it's settled" — the same idea as the success
   check drawing itself instead of popping. */
.price.flash-up { color: ${JUICE.green}; }
.price.flash-down { color: ${JUICE.red}; }
.chg {
  font-size: 11px; font-weight: 700; line-height: 1.3;
  padding: 2px 7px; border-radius: 7px;
  font-variant-numeric: tabular-nums;
}
.chg.up { color: ${JUICE.green}; background: rgba(48,209,88,.12); }
.chg.down { color: ${JUICE.red}; background: rgba(255,69,58,.12); }

/* The asset's mark beside its name. 34px, soft square — a circle here would
   fight the coin art, most of which is already circular inside its own frame.
   The hairline keeps a white-background logo from floating loose on the dark
   card. */
.col-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.logo {
  width: 34px; height: 34px; flex: none;
  border-radius: 9px; object-fit: cover;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.08);
}

/* ── The 24h strip: the day's shape, drawn from real hourly closes ─────────
   Direction colour matches the chip above it — the two must never disagree.
   The draw-in runs ONCE, on mount, inside the arrival's motion budget: the
   line sweeping left-to-right IS the card saying "this is live", and it says
   it exactly one time. pathLength=1 in the SVG normalises the dash length so
   no measurement happens here.

   THESE TIMINGS ARE BUDGETED AGAINST .brand, NOT CHOSEN FOR THE CHART. The
   first pass drew for 700ms after a 260ms wait, faded the area at 700ms and
   the dot at 900ms — so the chart finished at 1100ms while every other row
   had settled by 580ms. Nothing was slower to APPEAR (CSS animation never
   delays paint), but the card spent half a second visibly still assembling
   itself, and "still assembling" is what a person reads as slow. The dot now
   lands at 580ms, exactly with the brand row: the card settles as ONE thing
   instead of a card plus a chart still catching up. */
@keyframes spot-spark-draw {
  from { stroke-dashoffset: 1; }
  to   { stroke-dashoffset: 0; }
}
@keyframes spot-spark-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* The window the shape covers. Same muted-key treatment as the stat labels,
   because it is the same kind of word: the thing that makes the number
   beside it mean something. */
.spark-k {
  margin-top: 12px;
  font-size: 10px; font-weight: 600; letter-spacing: .06em;
  color: rgba(255,255,255,.38);
}
.spark { margin-top: 3px; line-height: 0; }
/* The sparkline is a DOOR now: a bare button wrapping the label+line, so a
   tap opens the ranged chart the way the chip's chevron does. No chrome of
   its own — the "›" on the label is the whole affordance, because a second
   framed control here would be the button that competes with Buy. */
.spark-open {
  display: block; width: 100%; margin: 0; padding: 0; border: 0;
  background: none; color: inherit; font: inherit; cursor: pointer;
  text-align: left;
}
.spark-open:hover .spark-k { color: rgba(255,255,255,.62); }
/* ── The ranged chart, at chip parity ── */
.card-chart-wrap { margin-top: 10px; position: relative; }
.cc-close {
  position: absolute; top: -2px; right: 0; z-index: 2;
  background: none; border: 0; cursor: pointer;
  font-size: 10px; font-weight: 700; letter-spacing: .04em;
  color: rgba(255,255,255,.4);
}
.cc-close:hover { color: rgba(255,255,255,.7); }
.cc-grow {
  position: absolute; top: -2px; right: 48px; z-index: 2;
  background: none; border: 0; cursor: pointer;
  font-size: 10px; font-weight: 700; letter-spacing: .04em;
  color: rgba(255,255,255,.4);
}
.cc-grow:hover { color: #5EC1FF; }

/* ── The enlarged chart ─────────────────────────────────────────────────────
   A SIBLING of .wrap, never a child. .wrap is position:fixed WITH a
   transform, and a transformed element becomes the containing block for
   any fixed descendant — a "fullscreen" overlay nested inside the card
   would have been fullscreen relative to a 344px card. Everything about
   this block depends on that, so do not move it inside .wrap.

   The scrim is dark enough to take the page out of the reading but not so
   dark that the reader loses where they are: this opens over somebody
   else's timeline and has to read as OUR panel on top of it, not as a
   navigation. */
@keyframes cc-scrim-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes cc-stage-in {
  from { opacity: 0; transform: translateY(10px) scale(.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.cc-scrim {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(4,8,14,.72);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 24px;
  box-sizing: border-box;
  animation: cc-scrim-in 160ms ease-out both;
}
.cc-stage {
  position: relative;
  width: min(760px, 100%);
  background:
    radial-gradient(130% 90% at 100% 0%, rgba(104,198,255,.16) 0%, rgba(104,198,255,0) 52%),
    linear-gradient(150deg, #101B2C 0%, #0A0D14 46%, #0C1626 100%);
  border: 1px solid rgba(122,201,255,.20);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05),
    0 24px 64px rgba(0,0,0,.6), 0 0 60px -14px rgba(104,198,255,.34);
  padding: 40px 18px 16px;
  box-sizing: border-box;
  font: 13px/1.45 PoppinSans, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  animation: cc-stage-in 220ms cubic-bezier(.16,1,.3,1) both;
}
.cc-shrink {
  position: absolute; top: 14px; right: 16px; z-index: 2;
  background: none; border: 0; cursor: pointer;
  font-size: 11px; font-weight: 700; letter-spacing: .04em;
  color: rgba(255,255,255,.45);
}
.cc-shrink:hover { color: rgba(255,255,255,.8); }
.cc-big .cc-range { font-size: 11px; padding: 5px 10px; }
.cc-big .cc-bell svg { width: 15px; height: 15px; }
.cc-big .cc-foot { font-size: 11px; }
/* touch-action: none, or a drag along the chart scrolls the page under it
   instead of scrubbing. cursor is a crosshair because the plot IS the
   control here — the small chart has no scrub and keeps the default. */
.cc-big-plot {
  min-height: 380px; touch-action: none; cursor: crosshair;
  user-select: none; -webkit-user-select: none;
}
/* THE READOUT, above the foot: what the finger is on, in the card's mono
   voice. It is the whole reason to enlarge — a bigger line you cannot
   interrogate is just a bigger line. */
.cc-read {
  display: flex; align-items: baseline; gap: 10px;
  font-variant-numeric: tabular-nums;
}
.cc-read-p { font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
.cc-read-t { font-size: 11px; color: rgba(255,255,255,.45); font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  .cc-scrim, .cc-stage { animation: none !important; }
}
.card-chart { display: flex; flex-direction: column; gap: 6px; }
.cc-head { display: flex; align-items: center; gap: 8px; }
.cc-ranges { display: flex; gap: 3px; flex-wrap: wrap; flex: 1; }
.cc-range {
  background: rgba(255,255,255,.06); border: 0; cursor: pointer;
  color: rgba(255,255,255,.42); font-size: 9.5px; font-weight: 700;
  letter-spacing: .03em; padding: 3px 6px; border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.cc-range.on { background: #5EC1FF; color: #041016; }
.cc-bell {
  background: rgba(255,255,255,.06); border: 0; cursor: pointer;
  border-radius: 999px; padding: 3px 5px; line-height: 0;
  flex-shrink: 0; color: rgba(255,255,255,.62);
  display: grid; place-items: center;
}
/* The shared SVG bell, sized to sit where the emoji sat. It takes its
   colour from the button, so "armed" can say so in the accent instead of
   relying on a background alone. */
.cc-bell svg { width: 13px; height: 13px; display: block; }
.cc-bell.on { background: rgba(94,193,255,.22); color: #5EC1FF; }
.cc-bellrow { display: flex; align-items: center; gap: 6px; }
.cc-bell-k { font-size: 10px; color: rgba(255,255,255,.5); font-weight: 600; }
.cc-bell-in {
  flex: 1; min-width: 0; background: rgba(0,0,0,.28);
  border: 1px solid rgba(255,255,255,.14); border-radius: 7px;
  color: #fff; font-size: 12px; padding: 4px 7px;
  font-variant-numeric: tabular-nums;
}
.cc-bell-set {
  background: #5EC1FF; color: #041016; border: 0; cursor: pointer;
  border-radius: 7px; font-size: 11px; font-weight: 700; padding: 5px 9px;
}
.cc-alertmsg { font-size: 10px; color: rgba(255,255,255,.5); }
/* min-height is the CHART's height, not a note's: at 40px every range
   flip collapsed the card and regrew it when the fetch landed. The plot
   area now holds its ground and the old line simply dims. */
.cc-plot { position: relative; line-height: 0; min-height: 108px; }
.cc-plot.cc-stale svg { opacity: .35; transition: opacity .16s ease-out; }
.cc-loading {
  position: absolute; top: 6px; right: 8px; line-height: 1;
  font-size: 10px; font-weight: 700; letter-spacing: .04em;
  color: rgba(255,255,255,.45); pointer-events: none;
}
.cc-plot svg { display: block; }
.cc-note {
  font-size: 11px; color: rgba(255,255,255,.42); text-align: center;
  padding: 22px 0; line-height: 1.4;
}
.cc-foot {
  display: flex; justify-content: space-between;
  font-size: 9.5px; color: rgba(255,255,255,.38);
  font-variant-numeric: tabular-nums;
}
.spark svg { display: block; }
.spark-line {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: spot-spark-draw 380ms cubic-bezier(.3,0,.2,1) 140ms forwards;
}
.spark-area { opacity: 0; animation: spot-spark-fade 260ms ease-out 300ms forwards; }
.spark-now  { opacity: 0; animation: spot-spark-fade 180ms ease-out 400ms forwards; }

/* Context numbers under the shape: label muted, value bright, dot-separated.
   Small on purpose — context, not headline. */
.statline {
  margin-top: 8px; display: flex; align-items: center; gap: 14px;
  font-size: 10px; font-weight: 600; letter-spacing: .02em;
  color: rgba(255,255,255,.85);
  font-variant-numeric: tabular-nums;
}
.stat { display: inline-flex; align-items: center; gap: 5px; }
.stat-k { color: rgba(255,255,255,.38); font-weight: 600; }
/* Alone in the strip — no Holders beside it, see the category note above the
   JSX — MC gets a little more room to read as a real number, not a footnote. */
.stat-solo { font-size: 12px; }

/* ── Actions: filled accent pill + red sell, EQUAL WIDTH ───────────────────
   Buy and Sell are peers — one buys, one sells, and neither is more the
   reader's likely intent than the other when they hold the asset. Emphasis
   lives in colour; size is not an argument the card should be making.

   The CTA is 44px tall with 14px/700 type. A control that spends money is
   pressed with a thumb's confidence, not a squint — the earlier 36px pill
   wearing 13px text was the card's biggest promise in its smallest voice. */
.acts { margin-top: 14px; display: flex; gap: 8px; }
.acts button { flex: 1; }
button {
  font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  padding: 8px 18px; border-radius: 999px;
  border: 1px solid ${JUICE.accent}; background: ${JUICE.accent}; color: ${JUICE.onAccent};
  transition: background-color 150ms ease-out, border-color 150ms ease-out,
    color 150ms ease-out, opacity 150ms ease-out, transform 90ms ease-out;
}
/* The press. 3% is a held button, not a bounce — feedback at the fingertip,
   invisible in a screenshot. */
button:not([disabled]):active { transform: scale(.97); }
.acts button, [data-act="confirm"], [data-act="gate-signin"], [data-act="gate-topup"] {
  padding: 13px 20px; font-size: 14px; letter-spacing: .01em;
  box-shadow: ${JUICE.glowMoney};
}
button[disabled] { opacity: .35; cursor: default; }
button:not([disabled]):hover { background: #86D2FF; border-color: #86D2FF; }
/* Sell is RED and buy is GREEN, which is the convention the owner settled
   on ("best practice lerde buy yeşil sell kırmızı değil mi?") and the one
   the timeline chip already uses. A reader should not have to read a label
   to know which direction a button points, and should not have to relearn
   the mapping between two surfaces of the same product.

   ONE red, Apple's dark-mode system red (${JUICE.red}). Sell and failure share the
   colour and are told apart by FORM: a filled pill is an action, a 6px dot
   beside text is a state. */
button.sell {
  background: ${JUICE.red}; border-color: ${JUICE.red}; color: #FFFFFF;
  box-shadow: 0 8px 26px -8px rgba(255,69,58,.5);
}
button.sell:not([disabled]):hover { background: #FF6961; border-color: #FF6961; }

/* ── The feed, on the card: latest voices + a composer, no doors ───────────
   Margins are 0 — the wrap's padding is the grid, and the earlier 16px
   side-margins put these rows on a second, narrower grid nothing else
   used. */
/* ── The conversation strip: one live line, in two places ──────────────────
   Replaces two static teaser rows. Two fixed rows are a screenshot of a
   conversation; one row carrying the NEWEST voice CHANGES when somebody
   speaks, and a thing that changes is the only thing that reads as live —
   the same argument the motion rules make about the card as a whole.

   Overlapping initials, then the sentence, then the count. The faces are
   the cheapest possible proof that PEOPLE are here, which is the entire
   pull of a conversation; the sentence is what they said; the number is how
   much more there is. One row, three jobs, no repetition anywhere else.

   Sized to survive the trade panel, which is where it earns its keep: the
   last thing read before money moves should be what other people said. */
.convo {
  display: flex; align-items: center; gap: 8px;
  width: 100%; margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid rgba(255,255,255,.07); border-radius: 12px;
  background: rgba(255,255,255,.04);
  color: #FFFFFF; font-size: 12px; line-height: 1.4; text-align: left;
  cursor: pointer; box-shadow: none;
  transition: background-color .16s ease-out, border-color .16s ease-out;
}
.convo:not([disabled]):hover {
  background: rgba(104,198,255,.09); border-color: rgba(104,198,255,.28);
}
/* The stack reads as a group of people rather than a list of letters. The
   border matches the card ground so the discs overlap cleanly. */
.convo-faces { display: inline-flex; flex: none; }
.convo-face {
  width: 19px; height: 19px; border-radius: 50%;
  background: rgba(104,198,255,.16); color: #9FD9FF;
  border: 1.5px solid #0C1421;
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  display: inline-flex; align-items: center; justify-content: center;
}
.convo-face + .convo-face { margin-left: -7px; }
/* One line, ellipsised: a stranger's paragraph must not grow the card on
   somebody else's page. */
.convo-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: rgba(255,255,255,.72);
}
/* Glyph + number, never a naked number: the right-hand slot of a row is
   where feeds put a TIME, so "14" alone was read as fourteen minutes. The
   speech bubble makes it a count and an invitation at once. */
.convo-count {
  flex: none; display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 700;
  color: rgba(255,255,255,.45);
  font-variant-numeric: tabular-nums;
}
.convo-count svg { display: block; opacity: .8; }
.convo:hover .convo-count { color: #9FD9FF; }
/* Photos fill the disc; the initial is the fallback underneath. */
.convo-face { background-position: center; background-repeat: no-repeat; }
.mini-compose { display: flex; gap: 6px; margin: 10px 0 0; align-items: center; }
.mini-compose input {
  flex: 1; min-width: 0;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.10); border-radius: 999px;
  color: #FFFFFF; font: inherit; font-size: 12px;
  padding: 8px 13px; outline: none;
  transition: border-color 150ms ease-out;
}
.mini-compose input:focus { border-color: rgba(104,198,255,.45); }
.mini-compose input::placeholder { color: rgba(255,255,255,.35); }
/* Appears only once there is something to post — iMessage's rule. At rest
   the row is one quiet field, not a field plus a button asking to be fed. */
.mini-compose button {
  flex: none; padding: 8px 14px; font-size: 12px; box-shadow: none;
}
/* ── Panel ─────────────────────────────────────────────────────────────────── */
@keyframes spot-panel-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.panel { animation: spot-panel-in 180ms ease-out; }

/* Buy | Sell — segmented, selected is the accent. */
.modes {
  margin-top: 14px; display: flex; gap: 2px;
  background: rgba(255,255,255,.06); border-radius: 999px; padding: 2px;
}
.modes button {
  flex: 1; font-size: 12px; font-weight: 600; padding: 7px 0;
  background: transparent; border: 0; border-radius: 999px; color: rgba(255,255,255,.5);
  box-shadow: none;
}
/* Hover yields to the selected state: :not([aria-selected="true"]) keeps the
   higher-specificity hover rule off the chip that is already lit, so a chip
   never dims BECAUSE the cursor is on it (the pressed state outranking hover
   is what a pressed thing means). Same exclusion on every selectable chip. */
.modes button:not([disabled]):not([aria-selected="true"]):hover { background: rgba(255,255,255,.06); }
.modes button[aria-selected="true"] { background: ${JUICE.accent}; color: ${JUICE.onAccent}; font-weight: 700; }
/* BOTH tabs are their own direction now. Sell was red and Buy was left on
   the brand accent, which read as "sell is a direction, buy is the default"
   — and the chip in the timeline draws Buy in green, so the card and the
   feed disagreed about what colour a buy is. */
.modes button[aria-selected="true"][data-mode="buy"] {
  background: ${JUICE_BUY_FILL}; color: ${JUICE.onBuyFill};
}
.modes button[aria-selected="true"][data-mode="sell"] { background: ${JUICE.red}; color: #FFFFFF; }

/* ── The amount: centered, dominant, focused on arrival ────────────────────
   The largest element on the card, because it is the thing being decided.
   Centered like every money keypad since Cash App: the number is the room,
   not a form field in it. No underline — a caret in the accent is enough
   chrome for "type here". The component scales the size down as digits grow
   and widths the input to its content so the pair stays optically centered. */
/* ── ONE LANGUAGE ACROSS THE THREE SURFACES ─────────────────────────────
   This was a naked number, centred and enormous — Cash App's move, and a
   good one on a surface that asks for nothing else. But the sheet now asks
   for a price too, and the price sits in a bordered field: two inputs
   drawn as different KINDS of thing, on a screen where the reader is
   comparing them. The chip's field is the one the product owner picked as
   the cleaner language, so this is that field, at the card's scale. */
.amount {
  display: flex; align-items: center; gap: 6px; margin-top: 14px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px; padding: 10px 14px;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.amount:focus-within {
  border-color: rgba(104,198,255,.55);
  box-shadow: 0 0 0 3px rgba(104,198,255,.12);
}
.amount span { font-weight: 700; color: ${JUICE.text2}; }
.amount input {
  font: inherit; font-weight: 700; color: #FFFFFF;
  background: transparent; border: 0; padding: 0;
  flex: 1; min-width: 0; text-align: left;
  outline: none; -moz-appearance: textfield;
  caret-color: ${JUICE.accent};
  font-variant-numeric: tabular-nums;
}
.amount input::-webkit-outer-spin-button, .amount input::-webkit-inner-spin-button {
  -webkit-appearance: none; margin: 0;
}
.amount input::placeholder { color: ${JUICE.text3}; font-weight: 700; }
/* No caret through the placeholder "0" — the zero IS the resting state, the
   caret appears with the first digit. (Cash App draws no caret at all.) */
.amount input:placeholder-shown { caret-color: transparent; }

/* Sell context, right under the number it bounds. */
.holding { margin-top: 8px; text-align: center; font-size: 12px; color: rgba(255,255,255,.45); }

/* Preset chips UNDER the amount — the two most common answers pre-typed,
   offered after the question, not before it. Squarer radius than the CTA:
   a chip is a suggestion, a pill is an action, and the corner is how the
   two read differently at speed. */
/* The order door: a sentence, not a button-shaped button. It reads as the
   quiet alternative under the loud presets, which is its exact rank. */
/* A confirm must never wear a colour that is not its direction — the same
   rule the chip's sheet follows, and the same reason: direction is the one
   thing that has to be unmistakable at the moment of the press.
   
   Both sides are spelled out now. Only sell used to be, on the reasoning
   that buy could keep the accent because the accent WAS the default; that
   left a blue buy confirm under a green Buy button one surface away. */
[data-act="confirm"][data-side="buy"]:not(:disabled) {
  background: ${JUICE_BUY_FILL};
  color: ${JUICE.onBuyFill};
  border-color: ${JUICE.buyFillDeep};
  --money-glow: ${JUICE.buyGlow};
  --money-glow-hi: ${JUICE.buyGlowHi};
}
[data-act="confirm"][data-side="buy"]:not(:disabled):hover {
  background: linear-gradient(180deg, #6FEB9E, #2FD46C);
  border-color: ${JUICE.buyFillDeep};
}
[data-act="confirm"][data-side="sell"]:not(:disabled) {
  background: ${JUICE_SELL_FILL};
  color: ${JUICE.onSellFill};
  --money-glow: ${JUICE.sellGlow};
  --money-glow-hi: ${JUICE.sellGlowHi};
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28),
              0 2px 10px -2px ${JUICE.sellGlow};
}
[data-act="confirm"][data-side="sell"]:not(:disabled):hover {
  background: linear-gradient(180deg, #FF8C83, #FF574C);
}

/* ── THE ORDER LEG ──────────────────────────────────────────────────────
   This replaced a link that read "or set an order at a price →" and sent
   the reader to the panel. The reason for the link was sound — a third
   copy of the order state machine is drift — but the fix was wrong: the
   panel it pointed at had itself fallen a correctness bug behind. One
   rulebook, three layouts, and this is one of the layouts. */
.kind-row { display: flex; gap: 4px; justify-content: center; margin: 2px 0 8px; }
.kind-btn {
  border: 0; background: none; cursor: pointer; font: inherit;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
  padding: 5px 10px; border-radius: 8px; color: ${JUICE.text2};
  transition: color .15s ease, background-color .15s ease;
}
.kind-btn:hover { color: #8b98a5; background: rgba(255,255,255,.05); }
.kind-btn[aria-pressed="true"] {
  color: ${JUICE.text}; background: rgba(255,255,255,.08);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.09);
}
.order-leg { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.order-lbl {
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: ${JUICE.text2}; text-align: center;
}
.order-field {
  display: flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 11px; padding: 8px 12px;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.order-field:focus-within {
  border-color: rgba(104,198,255,.6);
  box-shadow: 0 0 0 3px rgba(104,198,255,.12);
}
.order-cur { font-size: 16px; font-weight: 700; color: #71767b; }
/* The price is the point of a limit, so it is the biggest thing in the leg. */
.order-price {
  flex: 1; min-width: 0; border: 0; outline: none; background: none;
  /* 20px, not 18: the price is the point of a limit order and the chip
     already renders it at 21. Eighteen was also a hair under WCAG's
     large-text line (18.66 bold), which would have forced the placeholder
     as bright as a typed value — trading a legibility problem for a worse
     comprehension one. The size was the thing that was wrong. */
  font: inherit; font-size: 20px; font-weight: 700; color: ${JUICE.text};
  font-variant-numeric: tabular-nums; padding: 0; -moz-appearance: textfield;
}
.order-price::placeholder { color: ${JUICE.text3}; }
.order-price::-webkit-outer-spin-button,
.order-price::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
/* What the price MEANS — a separate answer from whether it is allowed. */
.order-read {
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
  padding: 4px 9px; border-radius: 999px;
  font-variant-numeric: tabular-nums;
  color: ${JUICE.text2}; background: rgba(255,255,255,.04);
}
.order-read.good { color: ${JUICE.green}; background: rgba(48,209,88,.12); }
.order-read.bad { color: ${JUICE.red}; background: rgba(255,69,58,.12); }
.order-note { font-size: 11.5px; font-weight: 600; color: ${JUICE.red}; text-align: center; }
/* HOW MANY BOUGHT, beside what they said. Green because it is the market's
   own colour for participation, tiny because a claim this strong does not
   need to shout — the receipts are one tap below it. */
.convo-proof {
  flex-shrink: 0;
  font-size: 10.5px; font-weight: 700;
  color: ${JUICE.green}; background: rgba(48,209,88,.12);
  padding: 2px 7px; border-radius: 999px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The same rows the chip draws, in the card's scale. One language. */
.oo-list { display: flex; flex-direction: column; gap: 5px;
           border-top: 1px solid rgba(255,255,255,.07);
           padding-top: 10px; margin-top: 10px; margin-bottom: 0; }
.oo-row { display: flex; align-items: center; gap: 8px;
          font-size: 12px; color: #939aa3; font-variant-numeric: tabular-nums; }
.oo-side { font-weight: 700; color: ${JUICE.text}; }
.oo-side.s { color: ${JUICE.redSoft}; }
.oo-gated { font-size: 10px; font-weight: 700; color: ${JUICE.amber};
            background: rgba(245,165,36,.12); padding: 1px 6px; border-radius: 999px; }
.oo-x { margin-left: auto; padding: 3px 8px; font-size: 11px;
        color: ${JUICE.text2}; border: 0; background: none; cursor: pointer;
        font: inherit; font-size: 11px; border-radius: 7px; }
.oo-x:hover:not(:disabled) { color: ${JUICE.redSoft}; background: rgba(255,69,58,.10); }
.oo-x:disabled { color: ${JUICE.text3}; cursor: default; }

.order-bal {
  font-size: 11.5px; font-weight: 600; color: ${JUICE.text2};
  text-align: center; margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
}
.order-bal.low { color: ${JUICE.amber}; }

.chips { margin-top: 16px; display: flex; gap: 8px; }
.chips button {
  flex: 1;
  font-size: 12px; font-weight: 600; padding: 8px 0; border-radius: 12px;
  color: rgba(255,255,255,.85); background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.10); box-shadow: none;
}
.chips button:not([disabled]):not([aria-pressed="true"]):hover { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.18); }
.chips button[aria-pressed="true"] {
  background: ${JUICE.accent}; color: ${JUICE.onAccent}; border-color: ${JUICE.accent}; font-weight: 700;
}

/* ── Quote & outcome: dot + text, never a banner ───────────────────────────── */
@keyframes spot-line-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.quote {
  margin-top: 12px; min-height: 20px;
  display: flex; align-items: baseline; justify-content: center; gap: 7px; flex-wrap: wrap;
  text-align: center;
  font-size: 13px; line-height: 1.5; color: rgba(255,255,255,.6);
  animation: spot-line-in 150ms ease-out;
}
.q-main { font-weight: 700; color: rgba(255,255,255,.85); }
.q-sub { font-size: 11px; color: rgba(255,255,255,.40); flex-basis: 100%; }
.dot {
  width: 6px; height: 6px; border-radius: 999px;
  align-self: center; flex: none;
}
.quote.pending .dot { background: ${JUICE.amber}; }
.quote.err .dot { background: ${JUICE.red}; }
.quote.pending { color: rgba(255,255,255,.85); font-weight: 600; }
.quote.err .q-main { color: ${JUICE.red}; font-weight: 600; }

/* ── The success moment ─────────────────────────────────────────────────────
   A confirmed fill is the one state that earns a moment: a ring that draws
   itself closed, a tick that lands in it, the line in full white. Feedback
   for a decision already made — which is exactly the line between an earned
   celebration and manufactured urgency, and why nothing else on this card
   moves like this. Robinhood throws confetti here; a check that takes 700ms
   to arrive is the version of that with its tie still on. */
@keyframes spot-ck-pop {
  0% { transform: scale(.6); opacity: 0; }
  60% { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes spot-ck-draw {
  from { stroke-dashoffset: var(--len); }
  to   { stroke-dashoffset: 0; }
}
.success { flex-direction: column; align-items: center; gap: 8px; margin-top: 16px; }
.success .q-main { color: #FFFFFF; font-size: 14px; }
.success-check { display: block; animation: spot-ck-pop 380ms cubic-bezier(.16,1,.3,1) both; }
.ck-ring {
  --len: 66; stroke-dasharray: 66; stroke-dashoffset: 66;
  animation: spot-ck-draw 420ms ease-out 80ms forwards;
}
.ck-tick {
  --len: 14; stroke-dasharray: 14; stroke-dashoffset: 14;
  animation: spot-ck-draw 240ms ease-out 420ms forwards;
}

[data-act="confirm"] { margin-top: 14px; width: 100%; border-radius: 999px; }
/* Disabled Confirm is a STATE, not a dimmed button: neutral fill, muted
   text, no glow. The .35-opacity accent of the earlier pass still read as
   pressable — a third of a promise is still a promise. */
[data-act="confirm"][disabled] {
  background: rgba(255,255,255,.07); border-color: transparent;
  color: rgba(255,255,255,.32); box-shadow: none; opacity: 1;
}
/* The flywheel door on a confirmed fill: accent-tinted ghost, full width. */
.ghost {
  background: rgba(104,198,255,.10); border-color: rgba(104,198,255,.35);
  color: #9FD9FF; box-shadow: none;
}
.ghost:not([disabled]):hover {
  background: rgba(104,198,255,.16); border-color: rgba(104,198,255,.5); color: #FFFFFF;
}
/* "Shared ✓" is a completed step, not a broken button. */
.ghost[disabled] { opacity: .6; }
/* Two destinations, side by side and EQUAL WIDTH. Emphasis lives in fill vs
   ghost — Poppin is the filled one because the post is what feeds the next
   reader's card — and a wider primary would be the card arguing rather than
   offering. Same rule as Buy/Sell above. */
.share-row { margin-top: 10px; display: flex; gap: 8px; }
.share-row button { flex: 1; font-size: 12px; padding: 9px 10px; box-shadow: none; }
/* In the feed it is alone and sits above the conversation, so it needs the
   top gap the panel's row already had from the button above it. */
.share-row-feed { margin-top: 12px; }

/* The onboarding ladder's rung: one sentence of context over one full-width
   step. Same accent pill as Confirm — it IS the confirm of its state. */
.gate-note { margin-top: 12px; text-align: center; font-size: 11px; line-height: 1.5; color: rgba(255,255,255,.5); }
[data-act="gate-signin"], [data-act="gate-topup"] { margin-top: 8px; width: 100%; border-radius: 999px; }

/* ── Disclosures: fine print at the decision, AFTER the button ─────────────
   The issuer line is owed to the reader and it stays on the panel — but it
   is context, not the headline, and the earlier pass opened the panel with
   it. Small, centered, under the CTA: read before money moves, leading
   nothing. ::first-letter capitalises the rendered line while the DOM keeps
   the catalog's lowercase "issued by …" verbatim. The restriction note is
   amber because it is a caution, not a decoration. */
.issuer {
  margin-top: 12px; text-align: center;
  font-size: 10px; letter-spacing: .02em; color: rgba(255,255,255,.38);
}
.issuer::first-letter { text-transform: uppercase; }
.warn {
  margin-top: 5px; text-align: center;
  font-size: 10px; line-height: 1.5; color: rgba(251,191,36,.78);
}

/* ── The page's conversation ────────────────────────────────────────────────
   Posts sit on the BRAND row, not beside Buy/Sell, because they are a
   different axis: a trade acts on the asset, a conversation acts on the page.
   Capped height with its own quiet scrollbar — a long thread must not push
   the money surface off the reader's screen. */
.posts {
  margin-top: 12px; max-height: 368px; overflow-y: auto;
  /* The wheel stops at the feed's edge instead of handing the page a scroll
     nobody aimed at — this card is a guest on someone else's page. */
  overscroll-behavior: contain;
  animation: spot-panel-in 180ms ease-out;
}
.posts::-webkit-scrollbar { width: 4px; }
.posts::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 999px; }
.post {
  padding: 8px 0; border-top: 1px solid rgba(255,255,255,.06);
  font-size: 12px; line-height: 1.5;
}
.post:first-child { border-top: 0; padding-top: 0; }
/* ── A post is a ROW WITH A FACE, not a byline ─────────────────────────────
   The author used to be a blue word inline with their own sentence, which
   reads as a comment thread rather than a feed. Face, name, direction tag,
   time — then what they said. The face is the cheapest proof a PERSON is on
   the other end, and on a social surface that proof is the product. */
.post-head-row {
  display: flex; align-items: center; gap: 7px; margin-bottom: 5px;
}
.post-ava {
  width: 20px; height: 20px; border-radius: 50%; flex: none; padding: 0;
  background-color: rgba(104,198,255,.16); background-position: center;
  border: 0; box-shadow: none;
  color: #9FD9FF; font-size: 9px; font-weight: 700; text-transform: uppercase;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
button.post-ava:hover { background-color: rgba(104,198,255,.28); }
/* Direction as a tag: the one thing a reader scanning trades looks for, in
   the same green and red the card's own buttons use. */
.post-tag {
  flex: none; font-size: 9px; font-weight: 700; letter-spacing: .03em;
  padding: 2px 6px; border-radius: 6px; text-transform: uppercase;
}
.post-tag.buy { color: ${JUICE.green}; background: rgba(48,209,88,.14); }
.post-tag.sell { color: ${JUICE.red}; background: rgba(255,69,58,.14); }
.post-when {
  margin-left: auto; flex: none;
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,.32);
  font-variant-numeric: tabular-nums;
}
/* A receipt reads as a number, not as prose. */
/* The star: sits in the identity subrow, quiet until it is ON. It is the
   only head control that does not move money, so it must not compete with
   the ones that do. */
.watch-star {
  display: inline-flex; align-items: center;
  background: none; border: 0; padding: 1px; margin-left: 2px;
  color: rgba(255,255,255,.38); cursor: pointer;
  transition: color .15s ease-out;
}
.watch-star:hover { color: rgba(255,255,255,.7); background: none; }
.watch-star.on { color: ${JUICE.accent}; }

.post-text-trade {
  font-weight: 700; color: #FFFFFF;
  font-variant-numeric: tabular-nums;
}

/* The copy-trade door. Quiet on purpose: the receipt is somebody else's
   news, and this offers to act on it without shouting over the sentence
   that earned the attention. It reads as a control (bordered pill) rather
   than as more text, because a row of prose with a coloured word in it is
   not something people press. */
.post-copy {
  display: inline-flex; align-items: center; margin: 6px 0 0;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(104,198,255,.12);
  border: 1px solid rgba(104,198,255,.34);
  color: ${JUICE.accent}; font-size: 11px; font-weight: 700; line-height: 1;
  cursor: pointer; font-family: inherit;
  transition: background-color .15s ease-out;
}
.post-copy:hover { background: rgba(104,198,255,.2); }

/* The author is a DESTINATION (their profile), so it dresses like one —
   accent text, underline on hover, still inline with the sentence. */
.post-author {
  color: rgba(255,255,255,.92); font-weight: 700; margin-right: 0;
  background: none; border: 0; padding: 0; font-size: inherit; cursor: pointer;
  box-shadow: none;
}
button.post-author:hover { text-decoration: underline; background: none; }

/* Presence: a quiet green dot + count in the HEAD, beside the ticker — live
   social proof belongs at the top, not whispered in the footer. STATIC dot —
   "live" is conveyed by the number existing, not by blinking at anyone. */
.presence {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 600;
  color: rgba(255,255,255,.5);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.presence-dot {
  width: 5px; height: 5px; border-radius: 999px; background: ${JUICE.green};
}
/* Wrap anywhere: a stranger's 60-character unbroken string must not widen the
   card on somebody else's page. */
.post-text { color: rgba(255,255,255,.75); overflow-wrap: anywhere; }

.post-empty { font-size: 12px; color: rgba(255,255,255,.45); line-height: 1.5; }

/* Feed chrome.

   Icon + number, aligned on the number's optical centre, with tabular figures
   so a count going 9 → 10 does not shift the row. The glyphs are inline paths
   rather than text arrows: "▲" renders differently in every font on the web
   and the card cannot control which font a fallback picks, so a text arrow was
   a shape we did not actually choose.

   Upvoted is the ONE state that takes the accent — a filled tint plus the blue
   number, so it reads at a glance without an animation to announce it. */
.post-acts { display: flex; gap: 6px; margin-top: 7px; }
.chip-act {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10);
  color: rgba(255,255,255,.62);
  box-shadow: none;
  transition: background-color 150ms ease-out, color 150ms ease-out,
    border-color 150ms ease-out, transform 90ms ease-out;
}
/* NO OPACITY ON THE GLYPH. This said opacity .85, which the panel's copy
   of the same chip has never had — so the identical control was drawn at two
   different weights on the two surfaces, and the chip's own colour
   (rgba(255,255,255,.62)) was being multiplied down to .53 here. That was
   survivable while the marks were solid; the set is half outlines now
   (components/chipGlyphs.ts) and a 1.5px stroke at .53 alpha is fainter than
   the chip's own border. The pressed state lifted the fade back to 1, which
   is the tell: the fade was never carrying meaning, only inconsistency. */
.chip-act svg { display: block; flex: none; }
.chip-act .num { font-variant-numeric: tabular-nums; line-height: 1; }
.chip-act:not([disabled]):not([aria-pressed="true"]):hover {
  background: rgba(255,255,255,.09); color: #FFFFFF; border-color: rgba(255,255,255,.20);
}
.chip-act[aria-pressed="true"] {
  color: ${JUICE.accent}; background: rgba(104,198,255,.12); border-color: rgba(104,198,255,.40);
}
.post-head { border-top: 0; padding-top: 0; }
/* A reply is a post with a smaller voice: same row, one step in, and a rule
   down its left edge so the nesting is read rather than counted. The face
   shrinks because the person replying is not the subject here. */
.reply { padding-left: 10px; border-left: 2px solid rgba(255,255,255,.10); border-top: 0; }
.reply .post-ava { width: 17px; height: 17px; font-size: 8px; }
.reply .post-author { font-size: 11px; }
.composer { margin-top: 10px; display: flex; gap: 6px; align-items: center; }
.composer input {
  flex: 1; font: inherit; font-size: 12px; font-weight: 400; color: #FFFFFF;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  border-radius: 999px; padding: 8px 13px; width: auto;
  outline: none; transition: border-color 150ms ease-out;
}
.composer input:focus { border-color: ${JUICE.accent}; }
.composer input::placeholder { color: rgba(255,255,255,.30); font-weight: 400; }
.composer button { font-size: 12px; padding: 8px 14px; flex: none; box-shadow: none; }
.post-err { margin-top: 6px; font-size: 11px; color: ${JUICE.red}; }

/* A row only its author can see. Muted, not alarming: the post exists, it
   just is not public — that is information, not an error. */
.post-hidden {
  margin-top: 6px; font-size: 10px; line-height: 1.4;
  color: rgba(255,255,255,.42);
}

.link {
  margin-top: 10px; padding: 0; background: none; border: 0;
  color: rgba(255,255,255,.45); font-size: 11px; font-weight: 600;
  box-shadow: none;
}
button.link:hover { color: ${JUICE.accent}; background: none; }

/* The door to the conversation once one EXISTS — at zero posts the composer
   on the card face does the inviting and this pill stays out of the row
   (two controls saying "Say something" was the card repeating itself). */
/* The card's one permanent door to the sidebar. Icon only: the footer is
   the card's quietest row and a word here would outrank the brand mark
   sitting next to it. */
.panel-door {
  width: 26px; height: 26px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  color: rgba(255,255,255,.72);
  box-shadow: none;
}
button.panel-door:hover {
  background: rgba(104,198,255,.14); border-color: rgba(104,198,255,.45); color: ${JUICE.accent};
}

/* ── Whose card this is ────────────────────────────────────────────────────── */
.brand {
  margin-top: 14px; padding-top: 11px;
  border-top: 1px solid rgba(255,255,255,.06);
  display: flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,.38);
  white-space: nowrap;
}
/* The reader's own cluster — balance, face, the conversation door — holds
   the right edge as ONE group, whichever of its members exist. Nothing in
   this row wraps or shrinks: it is one line of small fixed things, and a
   pill folding onto two lines reads as a broken control. */
.brand-right { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none; }
.mark { display: block; flex: none; }
/* The mark doubles as the inbox door when there is anything IN the inbox: a
   small accent-count badge on its corner. Accent, not alarm-red — "someone
   answered you" is good news, and the card does not do urgency. */
.inbox {
  position: relative; display: block; flex: none;
  background: none; border: 0; padding: 0; cursor: pointer;
  box-shadow: none;
}
button.inbox:hover { background: none; }
.inbox-badge {
  position: absolute; top: -5px; right: -7px;
  min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 999px; background: ${JUICE.accent}; color: ${JUICE.onAccent};
  font-size: 9px; font-weight: 700; line-height: 13px; text-align: center;
}
.wordmark {
  font-family: PoppinSans, Inter, -apple-system, sans-serif;
  font-size: 11px; font-weight: 700; letter-spacing: -.005em;
  color: rgba(255,255,255,.92);
}
/* Balance chip + avatar: the reader's own presence on the card. Tint only,
   no border — it is a fact about you, not a control. */
.me-cash {
  display: inline-flex; align-items: baseline; gap: 5px;
  font-size: 11px; font-weight: 700; color: #8FD3FF;
  background: rgba(104,198,255,.10);
  border-radius: 999px; padding: 3px 8px; flex: none;
  font-variant-numeric: tabular-nums;
}
/* The key inside the balance chip rides the accent, not the neutral grey the
   market strip uses: on a blue-tinted pill a grey label reads as disabled. */
.me-cash .stat-k { color: rgba(143,211,255,.55); font-weight: 600; }
.me-avatar {
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  border: 1px solid rgba(104,198,255,.4);
  background: ${JUICE.accent}; color: ${JUICE.onAccent};
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; cursor: pointer; padding: 0;
  box-shadow: none;
}

/* ── The one earned moment, given some room ─────────────────────────────────
   The ring-and-tick was right and small. This is the same moment with weight
   behind it: two rings leaving the check and one warm bloom under it, 700ms,
   once, then nothing.

   IT STILL OBEYS THE CARD'S RULE. Nothing loops, nothing pulses, nothing
   counts down — a fill has already happened and the reader has already
   decided, so this is confirmation and not persuasion. That is the whole line
   between a celebration and a slot machine, and a trading surface that gets
   it wrong is doing something worse than being tacky.

   IT LEAVES WHEN THE MOMENT DOES. These live inside the outcome block, and
   the outcome is retired the instant the reader touches the amount or changes
   side (see setQuote in mount.tsx) — so the celebration cannot still be
   sitting there while somebody lines up their next trade. */
@keyframes spot-sb-ring {
  0%   { opacity: .55; transform: translate(-50%,-50%) scale(.35); }
  70%  { opacity: .12; }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.9); }
}
@keyframes spot-sb-glow {
  0%   { opacity: 0; transform: translate(-50%,-50%) scale(.4); }
  28%  { opacity: .5; }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
}
/* The sentence arrives a beat after the mark, so the eye lands on the tick
   and then reads. One 6px rise — the same settle the card's own content uses,
   not a separate idea. */
@keyframes spot-sb-line {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.success-burst {
  position: absolute; left: 13px; top: 50%; width: 0; height: 0;
  pointer-events: none;
}
.success-burst .sb-ring,
.success-burst .sb-glow {
  position: absolute; left: 0; top: 0; border-radius: 50%;
}
.success-burst .sb-ring {
  width: 34px; height: 34px; margin: 0; border: 1.5px solid ${JUICE.green};
  transform: translate(-50%,-50%) scale(.35); opacity: 0;
  animation: spot-sb-ring 640ms cubic-bezier(.22,.61,.36,1) both;
}
.success-burst .sb-ring-2 { animation-delay: 120ms; }
.success-burst .sb-glow {
  width: 60px; height: 60px;
  background: radial-gradient(circle, rgba(48,209,88,.34) 0%, rgba(48,209,88,0) 70%);
  transform: translate(-50%,-50%) scale(.4); opacity: 0;
  animation: spot-sb-glow 700ms ease-out both;
}
/* The row has to be the burst's frame, or the rings anchor to the card. */
.quote.success { position: relative; }
.quote.success .q-main { animation: spot-sb-line 260ms 90ms ease-out both; }

/* ── The reader's own book ──────────────────────────────────────────────────
   Opened from the avatar, which used to throw the reader out to the side
   panel. Same arrival as the panel and the feed, because it is the same kind
   of move: a drawer inside the card, not a new place. */
.me-view { animation: spot-panel-in 180ms ease-out; }

/* Whose screen this is. Small and above the money, in the same order the
   card's own head reads: who first, then the number. A portfolio with a face
   on it is your account; one without is a report about somebody. */
/* CLEARS THE BACK BUTTON. The asset head used to be the first thing in every
   non-card view and .head-inset pushed it 26px right, past the nav-back at
   left:8px. Taking the head off this view took that clearance with it and the
   identity row slid under the arrow — the padding belongs to the view now,
   not to a header that is no longer there. */
.me-who {
  display: flex; align-items: center; gap: 9px;
  margin-top: 2px; padding-left: 26px; padding-right: 30px;
}
.me-who-ava {
  width: 30px; height: 30px; border-radius: 50%; flex: none;
  background: ${JUICE.accent}; color: ${JUICE.onAccent};
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  border: 1px solid rgba(104,198,255,.4);
  overflow: hidden;
}
/* The face itself, when there is one. An <img> rather than a background so a
   picture the host page refuses can fall back to the initial instead of to a
   blank disc — see Face in Me.tsx. */
.me-who-ava img, .me-face img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
/* Inside the footer avatar BUTTON, which already carries the disc's shape and
   colour, so this is only the clip. */
.me-face {
  width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
}
.me-who-n {
  font-size: 14px; font-weight: 700; letter-spacing: -.01em; color: rgba(255,255,255,.92);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Money leads. Somebody pressing their own face is asking a number, and the
   answer is the largest thing on the screen — the same hierarchy the head
   already uses, where the price outweighs the name. */
.me-hero { margin-top: 14px; display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.me-hero .stat-k { font-size: 11px; }
.me-hero-n {
  font-size: 27px; font-weight: 700; letter-spacing: -.02em;
  color: #FFFFFF; font-variant-numeric: tabular-nums; line-height: 1.05;
}
/* When all-time profit takes the hero, it wears its sign's colour — the
   strip's framing, so the biggest number on both surfaces says the same
   thing the same way. */
.me-hero-n.up { color: ${JUICE.green}; }
.me-hero-n.down { color: ${JUICE.red}; }
/* A standing order's row: the holdings row's bones with an exit on the
   right. Cancel is quiet ink until hovered — an exit should be findable,
   not advertised. */
.me-ord {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 0; border-top: 1px solid rgba(255,255,255,.07);
}
.me-ord:first-child { border-top: 0; padding-top: 0; }
.me-ord-s { font-size: 12.5px; font-weight: 700; display: block; }
.me-ord-s.buy { color: ${JUICE.green}; }
.me-ord-s.sell { color: ${JUICE.red}; }
.me-ord-x {
  flex: none; font-size: 11px; font-weight: 700;
  color: rgba(255,255,255,.45);
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 999px; padding: 3px 10px; cursor: pointer;
}
.me-ord-x:hover { color: ${JUICE.redSoft}; border-color: rgba(255,69,58,.35); }
.me-ord-x:disabled { opacity: .5; cursor: default; }
/* The profit rides the SAME two colours as the 24h chip, so green never means
   two different things on one card. Tinted, not glowing: a fact, not an
   advertisement — and it is absent entirely unless the whole book can answer
   (see onBook in spotCardFlow). */
.me-hero-d {
  font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 7px;
  font-variant-numeric: tabular-nums;
}
.me-hero-d.up { color: ${JUICE.green}; background: rgba(48,209,88,.12); }
.me-hero-d.down { color: ${JUICE.red}; background: rgba(255,69,58,.12); }

/* Cash sits UNDER the total rather than beside it: it is not a second
   headline, it is the part of the total you can spend right now. */
.me-cashline {
  margin-top: 5px; font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,.72); font-variant-numeric: tabular-nums;
}

.me-note { margin-top: 14px; font-size: 12px; color: rgba(255,255,255,.45); line-height: 1.5; }
.me-retry {
  background: none; border: 0; padding: 0; cursor: pointer;
  font: inherit; color: ${JUICE.accent}; font-weight: 700;
}

.me-holds {
  margin-top: 14px; max-height: 300px; overflow-y: auto;
  overscroll-behavior: contain;
}
.me-holds::-webkit-scrollbar { width: 4px; }
.me-holds::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 999px; }
/* A row is a DOOR now — tapping it opens that asset's card with the panel
   open. Styled as a row and not as a button on purpose: the book is a screen
   for reading what you have, and a list of buttons reads as a list of
   decisions to make. The hover is the whole affordance. */
.me-hold {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 6px; border-top: 1px solid rgba(255,255,255,.07);
  width: 100%; background: none; border-left: 0; border-right: 0;
  border-bottom: 0; border-radius: 8px; cursor: pointer;
  font: inherit; color: inherit; text-align: left;
}
.me-hold:hover:not([disabled]) { background: rgba(255,255,255,.05); }
.me-hold[disabled] { cursor: default; }
.me-hold:first-child { border-top: 0; padding-top: 0; }
.me-hold-l { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.me-hold-t {
  font-size: 12px; font-weight: 700; color: rgba(255,255,255,.92);
  letter-spacing: -.005em;
}
.me-hold-n {
  font-size: 11px; color: rgba(255,255,255,.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.me-hold-r { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: none; }
/* Value first, profit second. The profit is a tinted chip like the 24h move
   on the head — one grammar for "this number moved" across the whole card,
   instead of coloured text here and a chip there. */
.me-hold-v {
  font-size: 14px; font-weight: 700; color: rgba(255,255,255,.95);
  font-variant-numeric: tabular-nums; letter-spacing: -.01em;
}
.me-hold-p {
  font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 6px;
  font-variant-numeric: tabular-nums;
}
.me-hold-p.up { color: ${JUICE.green}; background: rgba(48,209,88,.12); }
.me-hold-p.down { color: ${JUICE.red}; background: rgba(255,69,58,.12); }

/* Two segments, borrowing the trade panel's Buy/Sell switch rather than
   inventing a second kind of tab — the card already taught this reader what a
   segmented control looks like, twelve pixels away. */
.me-tabs {
  margin-top: 14px; display: flex; gap: 4px;
  background: rgba(255,255,255,.05); border-radius: 10px; padding: 3px;
}
.me-tabs button {
  flex: 1; background: none; border: 0; cursor: pointer;
  border-radius: 8px; padding: 6px 0;
  font: inherit; font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,.5);
}
.me-tabs button[aria-selected="true"] {
  background: rgba(255,255,255,.10); color: rgba(255,255,255,.95);
}
.me-tabs button:not([aria-selected="true"]):hover { color: rgba(255,255,255,.75); }

.me-acts {
  margin-top: 12px; max-height: 300px; overflow-y: auto;
  overscroll-behavior: contain;
}
.me-acts::-webkit-scrollbar { width: 4px; }
.me-acts::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 999px; }
.me-act {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 9px 0; border-top: 1px solid rgba(255,255,255,.07);
}
.me-act:first-child { border-top: 0; padding-top: 0; }
.me-act-ava {
  width: 22px; height: 22px; border-radius: 50%; flex: none;
  background: rgba(255,255,255,.10); color: rgba(255,255,255,.8);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
}
/* The deed's mark on an event row — the same 22px tinted disc the strip's
   Activity band leads with, glyph strings shared via notificationText. */
.me-act-kind {
  width: 22px; height: 22px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${JUICE.accentInk}; background: rgba(104,198,255,.12);
}
.me-act-kind svg { width: 12px; height: 12px; display: block; }
/* The bell's direction tints — the strip's act-up/act-down, same colours,
   so the disc a reader learns on X means the same thing here. */
.me-act-kind.up { color: ${JUICE.green}; background: rgba(48,209,88,.12); }
.me-act-kind.down { color: ${JUICE.red}; background: rgba(255,69,58,.12); }
.me-act-t {
  flex: 1; min-width: 0; font-size: 12px; line-height: 1.45;
  color: rgba(255,255,255,.72); overflow-wrap: anywhere;
}
/* TWO LINES, THEN STOP. A trade receipt names the amount, the asset, the page
   and the product — true, and four lines of it turns a list into a wall. The
   text is not trimmed at the source: the card would then be showing something
   different from the feed, which is the disagreement this whole session has
   been undoing. It is clamped in the presentation, where it belongs. */
.me-act-x {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
/* Where and when, stacked in the row's top-right corner — the same place and
   the same order the side panel puts them. Right-aligned so the times form a
   column the eye can run down instead of landing wherever the text ended. */
.me-act-meta {
  flex: none; display: flex; flex-direction: column; align-items: flex-end;
  gap: 3px; padding-top: 1px;
}
.me-act-site { position: relative; display: inline-flex; cursor: default; }
.me-act-site img {
  width: 14px; height: 14px; border-radius: 3px; flex: none; display: block;
  opacity: .8;
}
.me-act-site:hover img { opacity: 1; }
/* The address, on hover, as SELECTABLE text.
   A native title= would have been one attribute and no CSS, and it is the
   wrong answer here: an OS tooltip cannot be selected, so the reader can see
   the URL and not take it. This is a child of the hovered element with no gap
   between them, which is what lets the pointer travel into it without the
   hover breaking — the usual reason CSS tooltips cannot be interacted with.
   Right-anchored because the row sits at the card's right edge and a
   left-anchored popup would leave the card. */
.me-act-url {
  position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 3;
  display: none; white-space: nowrap; user-select: text; cursor: text;
  background: #0A0D14; border: 1px solid rgba(122,201,255,.22);
  border-radius: 8px; padding: 5px 8px;
  font-size: 10px; color: rgba(255,255,255,.8);
  box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
.me-act-site:hover .me-act-url { display: block; }
.me-act-when {
  font-size: 10px; color: rgba(255,255,255,.35);
  font-variant-numeric: tabular-nums;
}
.me-act-ava { overflow: hidden; }
.me-act-ava img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* The feed's own buy/sell tag, borrowed rather than re-invented — .post-tag
   is defined above and the colours are already right. */
.me-act-t .post-tag { margin-right: 5px; vertical-align: 1px; }
.me-act-who { color: rgba(255,255,255,.95); font-weight: 700; }
/* Unread is a DOT, not a highlighted row. A tinted band behind every new line
   turns a list into a warning; a dot says "this one is new" and lets the text
   stay the thing being read. */
.me-act-dot {
  width: 6px; height: 6px; border-radius: 50%; flex: none;
  background: ${JUICE.accent}; margin-top: 7px;
}

/* The count rides the avatar's corner. Same shape and cap as the pill's badge
   — one badge grammar on this card, whichever surface is showing it. */
.me-avatar { position: relative; }
.me-avatar-badge {
  position: absolute; top: -4px; right: -5px;
  min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 999px; background: ${JUICE.accent}; color: ${JUICE.onAccent};
  font-size: 9px; font-weight: 700; line-height: 13px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #0A0D14;
}

/* A door, not a destination — the panel is one press further away than it
   was, and it looks it. Quiet by design, like the brand line. */
.me-more {
  margin-top: 14px; width: 100%; background: none;
  border: 1px solid rgba(255,255,255,.12); border-radius: 10px;
  padding: 8px 0; cursor: pointer;
  font-size: 12px; font-weight: 600; color: rgba(255,255,255,.55);
}
.me-more:hover { background: rgba(255,255,255,.05); color: rgba(255,255,255,.8); }

/* ── Reduced motion ─────────────────────────────────────────────────────────
   The whole point of a motion system is that it yields: anyone who has asked
   their OS for less movement gets a card that is simply THERE.

   LAST IN THE FILE, and that placement is the mechanism — every animation
   above is a single class selector, so equal specificity means source order
   decides and this wins on order alone. The card carries no override keyword
   anywhere, by rule and by test — all:initial at the boundary already won the
   fight with the page, so anything inside that still needs to shout is a sign
   the cascade is being worked around rather than used. */
@media (prefers-reduced-motion: reduce) {
  .wrap, .wrap.nudge, .wrap.leaving, .head, .acts, .brand, .panel,
  .quote, .posts, .me-view, .pill, .pill.pill-nudge,
  .success-check, .ck-ring, .ck-tick,
  .sb-ring, .sb-glow, .quote.success .q-main,
  .spark-line, .spark-area, .spark-now { animation: none; }
  /* The exit still has to END, or a card that cannot animate away never
     leaves: mount.tsx swaps to the tab on a timer regardless, but the card
     would sit at full opacity until that fires. */
  .wrap.leaving { opacity: 0; }
  /* The retreat is a courtesy, not a flourish, so it SURVIVES here — it is
     the thing keeping our mark off the middle of somebody's video. Reduced
     motion removes the travel, not the outcome: it simply arrives already
     at the edge instead of sliding there. */
  .pill { transition: none; }
  .ck-ring, .ck-tick { stroke-dashoffset: 0; }
  .spark-line { stroke-dashoffset: 0; }
  .spark-area, .spark-now { opacity: 1; }
  button:not([disabled]):active { transform: none; }
}

/* ── MOTION IS A PREFERENCE ──────────────────────────────────────────────
   Fifty-one animations and transitions in this stylesheet, two of them
   previously gated. A reader who has asked their system to stop moving
   things was still getting the rest. Nothing here means anything its end
   state does not already mean. */
@media (prefers-reduced-motion: reduce) {
  /* :host and the universal selector, NOT .poppin-spot-card - a class
     nothing carries. The host is marked with the ATTRIBUTE
     data-poppin-spot-card and lives
     outside this stylesheet's shadow root anyway, so the whole blanket
     matched nothing and every one of those animations kept running for a
     reader who had asked their system to stop. Inside the shadow tree the
     universal selector is the blanket. */
  :host,
  * {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}

/* RULE 6 — THE DATA SPEAKS MONO. The card's data classes; names, labels
   and sentences stay in the product face. Same boundary the chip draws,
   enforced by theme/juice.spec.ts. */
.price, .quote, .amount input, .amount span,
.order-price, .order-cur, .order-bal, .order-read,
.oo-row, .oo-side, .col-num, .chip-act .num,
.me-hero-n, .me-hero-d {
  font-family: ${JUICE.mono}; letter-spacing: -.01em;
}
`;