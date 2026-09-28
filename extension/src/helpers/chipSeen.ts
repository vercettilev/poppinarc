/**
 * WAS THE CHIP ACTUALLY ON SCREEN?
 *
 * `x_strip_shown` means "a chip was appended to the DOM", which is not the
 * same claim and was being read as if it were. Measured 2026-09-23: 13,773
 * chips against 5 readers who ever touched one. That number only means
 * "the design fails to invite a tap" if the chips were in front of a pair
 * of eyes — and on an infinite feed that mounts strips into cells above
 * and below the fold, nothing in the data said so.
 *
 * So this fires `x_strip_seen` beside it. The ratio between the two is the
 * measurement: it separates "they looked and did not care" from "they
 * never saw it", and those two findings lead to completely different work.
 *
 * DWELL, NOT A GLANCE. Half the chip for half a second. A feed flung past
 * at scroll speed technically intersects every cell it crosses, and
 * counting those would rebuild the same lie one level up.
 *
 * ONE PER MINT, mirroring `shownMints` in the strip. The two counts have
 * to be deduped identically or their ratio is not a ratio.
 */
export interface ChipSeenDeps {
  track(event: string, payload: Record<string, unknown>): void
  /**
   * Called the first time ANY chip clears the dwell, with that chip.
   *
   * The onboarding card used to draw itself on the first chip that
   * MOUNTED, which on an infinite feed is usually a chip nobody looks at:
   * measured 2026-09-25, 212 chips were placed and 38 were seen. Ten
   * readers were shown a coach that day and not one pressed Next, while
   * the same card clicked through in five seconds by hand. They were not
   * refusing it; it was being drawn where they were not looking.
   *
   * Unlike the tracking above this is NOT deduped by mint: the card wants
   * the first chip a reader actually rests on, whatever asset it names.
   */
  onSeen?(el: Element): void
  /** Fraction of the chip on screen that counts. */
  ratio?: number
  /** How long it has to stay there. */
  dwellMs?: number
  /** Injected for tests; defaults to the platform's. */
  makeObserver?: (
    cb: (entries: { target: Element; intersectionRatio: number }[]) => void,
    opts: { threshold: number[] },
  ) => { observe(el: Element): void; unobserve(el: Element): void; disconnect(): void }
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}

export interface ChipSeenWatch {
  /** Start watching one chip. Calling twice for the same mint is a no-op. */
  watch(el: Element, payload: { mint: string; tier: string }): void
  stop(): void
}

export function createChipSeenWatch(deps: ChipSeenDeps): ChipSeenWatch {
  const ratio = deps.ratio ?? 0.5
  const dwellMs = deps.dwellMs ?? 500
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id))

  const seenMints = new Set<string>()
  let announced = false
  /** Element -> what it is and the dwell timer currently running on it. */
  const watching = new Map<Element, { mint: string; tier: string; timer: number | null }>()

  type Obs = {
    observe(el: Element): void
    unobserve(el: Element): void
    disconnect(): void
  }

  const onEntries = (
    entries: { target: Element; intersectionRatio: number }[],
  ): void => {
    for (const e of entries) {
      const rec = watching.get(e.target)
      if (!rec) continue
      if (e.intersectionRatio >= ratio) {
        /* Already counting. Re-arming on every ratio step would restart the
           clock each time the entry fires on the way up, so a slow scroll
           past would never reach the dwell it is already earning. */
        if (rec.timer !== null) continue
        rec.timer = setTimer(() => {
          rec.timer = null
          const el = e.target
          stopWatching(el)
          /* The card first, and outside the mint dedup: a reader whose
             first rested-on chip names an asset another chip already
             reported would otherwise never be offered the card at all. */
          if (!announced) {
            announced = true
            try {
              deps.onSeen?.(el)
            } catch {
              /* The card is a courtesy; the count is the contract. */
            }
          }
          if (seenMints.has(rec.mint)) return
          seenMints.add(rec.mint)
          deps.track("x_strip_seen", { mint: rec.mint, tier: rec.tier })
        }, dwellMs)
      } else if (rec.timer !== null) {
        clearTimer(rec.timer)
        rec.timer = null
      }
    }
  }

  /**
   * BUILT ON THE FIRST CHIP, NOT AT STARTUP, and never at the cost of one.
   *
   * Eager construction threw `IntersectionObserver is not defined` in every
   * environment without one and took the whole strip down with it — 272
   * specs, and in a browser it would have been the chip itself. A count of
   * how many chips were looked at is worth exactly nothing next to the
   * chips, so a platform that cannot answer gets to stay silent: `watch`
   * becomes a no-op and the ratio simply has no numerator.
   *
   * Lazy also means a page that never mounts a chip never builds one.
   */
  let io: Obs | null = null
  let unavailable = false
  const observer = (): Obs | null => {
    if (io || unavailable) return io
    try {
      const make =
        deps.makeObserver ??
        ((cb, opts) =>
          new IntersectionObserver(
            (entries) =>
              cb(entries as unknown as { target: Element; intersectionRatio: number }[]),
            opts as IntersectionObserverInit,
          ))
      io = make(onEntries, { threshold: [0, ratio, 1] })
    } catch {
      unavailable = true
    }
    return io
  }

  function stopWatching(el: Element): void {
    const rec = watching.get(el)
    if (rec?.timer !== null && rec?.timer !== undefined) clearTimer(rec.timer)
    watching.delete(el)
    io?.unobserve(el)
  }

  return {
    watch(el, payload) {
      /* The mint is the unit, not the element. X mounts the same asset into
         several cells on one screenful and recycles them as you scroll;
         watching each one would count one asset many times and the ratio
         against `shownMints` would read above 1. */
      if (seenMints.has(payload.mint) || watching.has(el)) return
      const obs = observer()
      if (!obs) return
      watching.set(el, { mint: payload.mint, tier: payload.tier, timer: null })
      obs.observe(el)
    },
    stop() {
      for (const rec of watching.values()) {
        if (rec.timer !== null) clearTimer(rec.timer)
      }
      watching.clear()
      io?.disconnect()
    },
  }
}
