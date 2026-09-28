/**
 * THE PAGE-WALLET PROTOCOL, AND THE VERSION THAT IS PART OF IT.
 *
 * The MAIN-world bridge (entries/contentScript/pageWallet.ts) is a PAGE
 * script. An extension update does not touch it: the old file keeps running,
 * with the old listener registered, until the page itself navigates. Only the
 * two halves that ship INSIDE the extension — the isolated-world caller
 * (helpers/pageWalletBridge.ts) and the background's injector — are new.
 *
 * MEASURED, 1.0.344. `signMessage` was added to the bridge on 2026-09-22.
 * On every tab that was open when that version installed, the bridge in the
 * page was the one from the version before, which knows probe, connect and
 * sign and nothing else. Its handler falls off the end for an op it does not
 * know — no reply, not even an error — so the panel's connect button opened
 * Phantom, the reader approved, and sixty seconds later the panel said
 * "Closed in Phantom before signing." They approved and were told they
 * cancelled. The bridge's one-per-page marker was `true`, so the background
 * read "already there" and re-injection could not rescue it either.
 *
 * TWO THINGS FIX THAT, AND BOTH ARE HERE.
 *
 * 1. THE MARK IS A VERSION, not a boolean. A newer bridge takes over a page
 *    an older one claimed (claimed < ours), and the background asks the same
 *    question before it decides there is nothing to inject. `true` is read as
 *    version 1, because that is what the first bridge wrote and those pages
 *    are exactly the ones that need taking over.
 *
 * 2. THE WIRE TYPE CARRIES THE VERSION. Taking over does not remove the old
 *    listener — nothing can, we hold no reference to it and the page is not
 *    reloading — so for a moment TWO bridges are listening on one window. If
 *    both answered, a single `sign` would open two wallet popups and send two
 *    transactions, and a `connect` would race two replies for one id. The old
 *    listener's first act is `msg.type !== "POPPIN_WALLET_REQ" → return`, so
 *    naming the version in the type is what makes it deaf to us: it hears
 *    nothing, answers nothing, and spends nothing. One version, one listener,
 *    one reply.
 *
 * The caller half and the bridge half ship together in the same extension, so
 * they are never out of step with each other — only ever with a page that
 * still holds an older bridge, which is precisely the case this is for.
 */

/** Bumped whenever the ops, their arguments or their replies change. */
export const PAGE_WALLET_VERSION = 2

/** The wire types, versioned by construction so a bump cannot forget one. */
export const PAGE_WALLET_REQ = `POPPIN_WALLET_REQ_V${PAGE_WALLET_VERSION}`
export const PAGE_WALLET_RES = `POPPIN_WALLET_RES_V${PAGE_WALLET_VERSION}`

/**
 * Which bridge, if any, already owns this page. `true` is the first one
 * (probe, connect, sign); a number is its own version; anything else — the
 * page's own junk on the same key included — is nobody.
 */
export function claimedPageWalletVersion(mark: unknown): number {
  if (typeof mark === "number" && Number.isFinite(mark)) return mark
  return mark === true ? 1 : 0
}
