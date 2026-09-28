/**
 * HOW LONG SOMEBODY ACTUALLY LOOKED AT A STEP.
 *
 * THE MEASUREMENT THIS REPLACES WAS A MIRAGE. Every onboarding event fires
 * on load, so the span from a person's first event to their last one is
 * the time the PAGE took to settle, not the time they spent reading it.
 * Measured 2026-09-25: the median span for the twenty-seven readers who
 * never finished sign-in was ONE SECOND, which reads like a bounce and is
 * equally consistent with someone studying the screen for five minutes and
 * then closing the tab. Both stories produce the same one second, and a
 * number that cannot separate them cannot be acted on.
 *
 * MARKS, NOT AN UNLOAD HANDLER. A beacon on pagehide is the obvious
 * design and the unreliable one: an extension page hands its telemetry to
 * the service worker through sendMessage, and a message posted while the
 * page is tearing down often never arrives. Marks laid down DURING the
 * visit survive any ending, including a killed tab and a closed laptop.
 * The highest mark a step records is the dwell.
 *
 * VISIBLE TIME ONLY. The welcome tab can sit behind other tabs for hours,
 * and counting that would turn "opened it and forgot" into "read it
 * carefully" — the exact confusion this file exists to end.
 *
 * Four marks, so a step costs at most four extra events and the buckets
 * still say something different from one another: a glance, a read, a
 * decision, and a person who stopped to think.
 */
export const DWELL_MARKS = [5, 15, 60, 180] as const;

/**
 * Which marks are due, given visible time so far and the ones already
 * sent. Pure, so the hook around it has nothing left to get wrong.
 */
export function dueMarks(
  visibleMs: number,
  fired: ReadonlySet<number>,
): number[] {
  if (!Number.isFinite(visibleMs) || visibleMs < 0) return [];
  return DWELL_MARKS.filter((s) => visibleMs >= s * 1000 && !fired.has(s));
}
