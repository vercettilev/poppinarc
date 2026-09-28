import { useEffect, useRef, useState } from "react"

/**
 * A NUMBER THAT ARRIVES INSTEAD OF TELEPORTING.
 *
 * The book paints from cache first - yesterday's total NOW - and the live
 * answer lands a beat later. Replacing one with the other in a single frame
 * makes the headline blink to a different figure with nothing to say a
 * refresh happened; the reader who was looking at $412 sees $389 and cannot
 * tell whether the market moved or the first number was a lie.
 *
 * So the digits travel. The FIRST value is painted whole - there is nothing
 * to travel from on a cold open, and counting up from zero would be an
 * animation about our loading rather than about their money. Every value
 * after that eases from the one before, which is exactly the same rule the
 * chip's count-up follows.
 *
 * Returns null while the value is null, so "we could not look" keeps
 * reading as absence rather than as zero.
 */
/**
 * Does this change earn a ride? The decision, separated from the hook so it
 * can be read and tested without a renderer.
 *
 * Null in either position is a hard no: null means "we could not look", and
 * easing between absence and a number invents the numbers in between. A
 * cold open has no `from` for the same reason - the first value is the
 * truth, immediately.
 */
export function countAnimates(
  from: number | null,
  target: number | null,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion) return false
  if (from === null || target === null) return false
  return from !== target
}

/** Where the number is at progress t (0..1), on the surfaces' own ease. */
export function countValueAt(from: number, target: number, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  const eased = 1 - Math.pow(1 - clamped, 3)
  // Exactly the target at the end: a headline that stops a cent short is
  // worse than one that never moved.
  return clamped >= 1 ? target : from + (target - from) * eased
}

export function useCountUp(target: number | null, ms = 420): number | null {
  const [shown, setShown] = useState<number | null>(target)
  const fromRef = useRef<number | null>(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    const from = fromRef.current
    fromRef.current = target
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!countAnimates(from, target, reduced)) {
      setShown(target)
      return
    }
    const started = performance.now()
    const step = (now: number) => {
      const t = (now - started) / ms
      setShown(countValueAt(from as number, target as number, t))
      if (t < 1) frameRef.current = requestAnimationFrame(step)
      else frameRef.current = null
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [target, ms])

  return shown
}
