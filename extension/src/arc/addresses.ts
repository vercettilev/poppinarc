import { ARC_EDITION } from "~/config/edition"
import { solanaAddressesIn } from "~/helpers/solanaAddresses"

/**
 * CONTRACT ADDRESSES IN A TWEET, per edition.
 *
 * The store chip reads base58 runs (helpers/solanaAddresses.ts). On Arc a
 * token is a 0x address, which that reader never matches, and worse, about
 * one checksummed address in thirteen contains a 41-character zero-free run
 * that it WOULD extract as an "x…" candidate and spend a by-mint call on. So
 * the Arc edition replaces the Solana reader rather than running beside it.
 *
 * 0x plus exactly 40 hex digits, not glued to more hex on either side: the
 * trailing guard is what keeps a 64-hex transaction hash from yielding its
 * first 40 digits as an address. Lowercased, because the backend and every
 * comparison in the chip speak lowercase, and deduped after lowercasing so a
 * checksummed and a plain copy of one address cost one question.
 */
const EVM_RUN = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g

export function evmAddressesIn(text: string, max = 2): string[] {
  const out: string[] = []
  for (const m of text.matchAll(EVM_RUN)) {
    const s = m[0].toLowerCase()
    if (!out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** The address reader this edition's chip uses. */
export function contractAddressesIn(text: string, arc: boolean = ARC_EDITION, max = 2): string[] {
  return arc ? evmAddressesIn(text, max) : solanaAddressesIn(text, max)
}
