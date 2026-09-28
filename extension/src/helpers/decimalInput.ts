/**
 * DECIMAL FIELDS THAT SPEAK US ENGLISH, EVERYWHERE, ON EVERY KEYBOARD.
 *
 * The bug this ends, seen live on the card: typing "." into the limit price
 * CLOSED the whole sheet, while "," worked. Two separate failures wearing
 * one symptom:
 *
 *   1. `<input type="number">` is LOCALE-AWARE. On a Turkish-locale Chrome
 *      the accepted decimal separator is the comma; the dot is silently
 *      dropped. Our parsers, our formatters and our placeholders all speak
 *      US ("$0.004945"), so the field and the product disagreed about what
 *      a decimal even looks like.
 *
 *   2. Keys BUBBLE OUT of our shadow roots into the host page, and x.com
 *      binds single-key shortcuts on the document. "." is one of X's
 *      shortcuts — pressing it in our field also pressed it on X, X churned
 *      the DOM under the card, and the card dismissed. The comma "worked"
 *      only because X binds nothing to it. This is bigger than the dot:
 *      "l" likes the tweet under the reader's cursor, "r" opens a reply.
 *
 * So: decimal fields are `type="text"` + `inputMode="decimal"` (same mobile
 * keypad, no locale opinions), input is normalised through ONE function
 * (comma becomes dot, everything else non-numeric drops, one dot only), and
 * every surface that lives inside somebody else's page fences its keyboard
 * with `fenceKeys` so a keystroke in our field is never also a keystroke on
 * the page.
 *
 * The file kept its name and grew two more fences on the same principle,
 * because "inside stays inside" turned out to be the whole answer three
 * times: `fencePointers` for the press (a click on our key was also a click
 * on the tweet, which navigated), and `fencePointerMotion` for the sweep (a
 * pointer moving across our chip was also a pointer moving across X's cell,
 * which re-renders on hover). Each carries its own incident below; none of
 * them ever calls preventDefault.
 */

/** "1,5" → "1.5" · "1.2.3" → "1.23" · "abc" → "" — US shape, always. */
export function normalizeDecimal(raw: string): string {
  const swapped = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "")
  const firstDot = swapped.indexOf(".")
  if (firstDot === -1) return swapped
  // Keep the first dot; later ones are typos, not syntax.
  return (
    swapped.slice(0, firstDot + 1) +
    swapped.slice(firstDot + 1).replace(/\./g, "")
  )
}

/**
 * Stop key events at an element's edge so the host page never hears them.
 * Bubble-phase on purpose: the events START inside our shadow root, so they
 * reach `el` on the way OUT — stopping them here is what "inside stays
 * inside" means. Returns an unsubscribe for surfaces that unmount.
 */
export function fenceKeys(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation()
  const kinds = ["keydown", "keypress", "keyup"] as const
  for (const k of kinds) el.addEventListener(k, stop)
  return () => {
    for (const k of kinds) el.removeEventListener(k, stop)
  }
}

/**
 * The same fence for POINTERS, and the same reasoning one layer over.
 *
 * X makes the whole tweet cell one big link: a click anywhere inside the
 * article that is not itself a control navigates to the status page. That
 * was harmless while our host hung off the END of the article — outside its
 * click target. Anchoring the chip under the tweet's own action row put it
 * INSIDE, and pressing Buy started opening the tweet instead: our handler
 * ran, then the same click carried on up and X's did too.
 *
 * Bubble-phase again, and it is enough even against React's delegated
 * listeners, which fire at the ROOT container — an event stopped at our
 * host never gets there. mousedown/up and the pointer/touch pairs go with
 * click because X arms parts of that gesture separately, and a half-fenced
 * gesture is how you get a navigation with no click. No preventDefault
 * anywhere: our own buttons, focus and scrolling must all still work.
 */
export function fencePointers(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation()
  const kinds = [
    "click",
    "auxclick",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchend",
  ] as const
  for (const k of kinds) el.addEventListener(k, stop)
  return () => {
    for (const k of kinds) el.removeEventListener(k, stop)
  }
}

/**
 * AND THE THIRD FENCE: MOTION. Separate from the one above because the
 * reason is different, and a fence whose comment explains somebody else's
 * incident is a fence nobody can reason about later.
 *
 * The incident: a chip planted INSIDE x.com's article, reported as
 * "closing and re-opening while I move the mouse around the buy/sell
 * area". X's cell is a React subtree that re-renders on its own hover
 * state, and a foreign child of a subtree that re-renders can be taken
 * with it — so every pointer event of ours that reaches X's tree is a
 * chance for X to redraw the ground under our feet, for nothing.
 *
 * WHAT ACTUALLY LEAKS, which is narrower than it looks. `mouseover` and
 * `mouseout` carry a relatedTarget, and the DOM dispatch algorithm stops
 * building the event path at the node the relatedTarget retargets to ("if
 * parent is relatedTarget, then set parent to null"). For a pointer moving
 * from one control to another INSIDE the same shadow root, both ends
 * retarget to the host — so those events never reach the host and never
 * reach the page. `mousemove` and `pointermove` have no relatedTarget and
 * no such stop: they cross the boundary on every frame the pointer is over
 * us, retargeted to the host, and bubble the length of somebody else's
 * page. Those are the ones fenced here.
 *
 * WHAT IS DELIBERATELY NOT FENCED: mouseover/mouseout on ENTERING and
 * LEAVING. Those two do reach the host, and they are the host page's
 * legitimate business — it is how a page learns the pointer moved onto or
 * off the region our chip occupies. Swallow them and the page's own hover
 * state can stick lit, or never light, around the thing we are sitting in.
 * A fence that fixes our flicker by breaking their hover has not fixed
 * anything.
 *
 * Bubble phase, no preventDefault, as everywhere else in this file: our
 * own listeners live BELOW the host (a chart scrub reads pointermove on
 * its own svg), so they have already run by the time the event arrives
 * here to be stopped.
 */
export function fencePointerMotion(el: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation()
  const kinds = ["mousemove", "pointermove"] as const
  for (const k of kinds) el.addEventListener(k, stop)
  return () => {
    for (const k of kinds) el.removeEventListener(k, stop)
  }
}
