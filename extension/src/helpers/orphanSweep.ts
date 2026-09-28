/**
 * BURY THE PREDECESSOR.
 *
 * Reloading the extension (an update from the store does this too) orphans
 * the content scripts already living in open tabs: their DOM stays on the
 * page, their handlers half-work, and nothing ever removes them. Measured
 * on CoinGecko the day this was written: a reload mid-session left the old
 * context's card on the page, the new context mounted its own, and the
 * reader saw two overlapping cards where the × on the buried one appeared
 * to do nothing.
 *
 * mountSpotCard already sweeps before mounting — but only before MOUNTING.
 * A new context that decides not to mount (the chip owns the page, the
 * match came back empty) never runs that sweep, and the corpse stays. So
 * the sweep runs at BOOT, unconditionally: anything wearing our marks when
 * a live context starts belongs to a dead one.
 *
 * data-poppin-x is deliberately absent from the selector: that attribute
 * marks the PAGE's own tweet cells as processed, and removing those nodes
 * would tear tweets out of somebody's timeline. The new context re-adopts
 * marked cells on its own.
 *
 * ONCE PER PAGE, GUARDED ON WINDOW. Both content scripts import this, and
 * they share one isolated world — without the guard, whichever script
 * boots second would sweep away whatever the first had already mounted.
 * A reload creates a fresh isolated world, so the flag never survives to
 * protect a corpse.
 */
import { extensionAlive } from "./extensionContext"

const SWEPT_FLAG = "__poppin_orphans_swept"

export function sweepOrphanRoots(doc: Document = document): void {
  const w = (doc.defaultView ?? window) as unknown as Record<string, unknown>
  if (w[SWEPT_FLAG]) return
  w[SWEPT_FLAG] = true
  doc
    .querySelectorAll("[data-poppin-spot-card], [data-poppin-strip]")
    .forEach((n) => n.remove())
}

/**
 * THIS INSTANCE'S NAME, stamped on every host it creates. The boot sweep
 * above buries whatever was on the page when we arrived; it cannot see a
 * host that appears afterwards. And one did, on CoinGecko: two cards at
 * once, both alive, both updating their own price, the × on one leaving
 * the other. Whatever puts a second host on the page (an older build
 * still running in a tab it was injected into, a second injection this
 * file's guard could not see), the rule that holds is simpler than any
 * theory of how it got there: a host this instance did not stamp is not
 * ours, and it goes the moment it appears.
 */
export const INSTANCE_ID: string = (() => {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random()}`
  }
})()
export const INSTANCE_ATTR = "data-poppin-instance"

const OURS = "[data-poppin-spot-card], [data-poppin-strip]"

/** Stamp a host as this instance's, so the watcher below leaves it alone. */
export function claimHost(host: Element): void {
  host.setAttribute(INSTANCE_ATTR, INSTANCE_ID)
}

let watching = false
export function watchForStrangers(doc: Document = document): void {
  if (watching || typeof MutationObserver === "undefined") return
  watching = true
  const isStranger = (n: Element) =>
    n.matches(OURS) && n.getAttribute(INSTANCE_ATTR) !== INSTANCE_ID
  const mo = new MutationObserver((records) => {
    /**
     * THE CORPSE MUST NOT BURY THE LIVING.
     *
     * Both contexts run this same code, and "stranger" is symmetric: to
     * the orphan left behind by an auto-update, every host the NEW context
     * mounts is a stranger, and this observer removed all of them. The
     * reader's symptom was the worst kind — after an update the extension
     * simply stopped appearing, on every site, until the page was
     * reloaded. The card was killed the same way, because mount.tsx
     * stamps and claims before it appends.
     *
     * There is exactly one asymmetry between the two contexts and it is
     * the right one to hang this on: Chrome clears `runtime.id` on the
     * context it tore down. A context that cannot reach the extension has
     * no business deciding what belongs on the page, so it stops watching
     * — permanently, because that transition is one-way and the only
     * repair is a reload the reader makes.
     */
    if (!extensionAlive()) {
      mo.disconnect()
      return
    }
    for (const r of records) {
      r.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return
        if (isStranger(node)) {
          node.remove()
          return
        }
        node.querySelectorAll?.(OURS).forEach((n) => {
          if (isStranger(n)) n.remove()
        })
      })
    }
  })
  mo.observe(doc.documentElement, { childList: true, subtree: true })
}
