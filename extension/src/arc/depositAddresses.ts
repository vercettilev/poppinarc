import { useQuery } from "@tanstack/react-query"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * WHERE A PERSON CAN SEND USDC FROM, per network (GET /arc/deposit-addresses).
 *
 * The Arc address is the wallet itself. Every other address is a Circle wallet
 * of the same person on another network, swept to Arc by arc-api's deposits
 * service, so USDC sent to any of them ends up in the one balance. The panel
 * shows Arc first because it is the direct route, and the others one tap
 * away, each with its network named: the network is the one fact that decides
 * whether money sent to an address arrives.
 *
 * WHAT THE SERVER STANDS BEHIND. arc-api lists a network only when its sweep
 * pays its own gas (a Solana wallet it tops up with SOL, an EVM smart account
 * under Gas Station), so the card never has to second-guess a row. What the
 * sweep does not move is a balance under its floor (DEPOSIT_MIN_USDC and
 * DEPOSIT_MIN_USDC_SOL), and that floor is the server's to state: a row that
 * carries `minUsdcRaw` shows it, and the card promises "on its own" only when
 * every row has said where that promise starts.
 */

export interface DepositNetworkAddress {
  network: string
  address: string
  /** The smallest amount the sweep moves, as a person reads it ("5", "2.5"). */
  minUsdc?: string
}

export interface DepositAddresses {
  arc: { network: "Arc"; address: string }
  others: DepositNetworkAddress[]
  /**
   * No wallet yet, and this deploy trades from people's own wallets: the
   * screen offers to connect one (arc/ConnectWalletCard.tsx). The Arc address
   * is then empty.
   */
  connectWallet?: true
}

export const DEPOSIT_ADDRESSES_ROUTE = "/arc/deposit-addresses"

const EVM = /^0x[0-9a-fA-F]{40}$/
/** Base58, the Solana deposit address; case-exact, never lowercased. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const USDC_UNIT = 1_000_000n

/**
 * A raw 6-decimal USDC figure (a decimal-integer string, the wire's form) as
 * a person reads it: "5000000" is "5", "2500000" is "2.5". Anything that is
 * not a positive integer string is no figure at all, and the row then shows
 * no floor rather than a wrong one.
 */
export function usdcFromRaw(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{1,30}$/.test(raw)) return null
  const n = BigInt(raw)
  if (n <= 0n) return null
  const frac = (n % USDC_UNIT).toString().padStart(6, "0").replace(/0+$/, "")
  return frac ? `${n / USDC_UNIT}.${frac}` : `${n / USDC_UNIT}`
}

/** EVM addresses lowercase, a Solana address as it came; anything else is not an address. */
function cleanAddress(a: unknown): string | null {
  if (typeof a !== "string") return null
  const s = a.trim()
  if (EVM.test(s)) return s.toLowerCase()
  if (BASE58.test(s)) return s
  return null
}

/**
 * The server's answer, checked before any of it is put in front of somebody
 * about to send money. A row that is not a real address, or names no network,
 * is dropped rather than shown: an address with the wrong label is worse than
 * one fewer option. No usable Arc address means no answer at all, and the
 * screen falls back to the wallet address it already has.
 */
export function parseDepositAddresses(body: unknown): DepositAddresses | null {
  const root = (body as { data?: unknown } | null)?.data ?? body
  const r = root as { arc?: { address?: unknown }; others?: unknown; connectWallet?: unknown } | null
  if (!r || typeof r !== "object") return null
  if (r.connectWallet === true) return { arc: { network: "Arc", address: "" }, others: [], connectWallet: true }
  const arcAddress = cleanAddress(r.arc?.address)
  if (!arcAddress || !EVM.test(arcAddress)) return null
  const others: DepositNetworkAddress[] = []
  const seen = new Set<string>()
  for (const o of Array.isArray(r.others) ? r.others : []) {
    const network = typeof o?.network === "string" ? o.network.trim() : ""
    const address = cleanAddress(o?.address)
    if (!network || !address) continue
    // Arc is already the first row; a second Arc row would be the same door twice.
    if (network.toLowerCase() === "arc") continue
    const key = `${network.toLowerCase()}|${address}`
    if (seen.has(key)) continue
    seen.add(key)
    const minUsdc = usdcFromRaw(o?.minUsdcRaw)
    others.push(minUsdc ? { network, address, minUsdc } : { network, address })
  }
  return { arc: { network: "Arc", address: arcAddress }, others }
}

export async function fetchDepositAddresses(): Promise<DepositAddresses | null> {
  const body = await sendApiRequest<unknown>({ url: DEPOSIT_ADDRESSES_ROUTE, method: "GET" })
  return parseDepositAddresses(body)
}

/**
 * The addresses rarely change (they are made once per person and network), so
 * one read per panel session is enough. `enabled` is false in the store build,
 * whose backend has no such route.
 */
export function useDepositAddresses(enabled: boolean) {
  return useQuery({
    // Not under ["wallet"]: Receive invalidates that every ten seconds while
    // it watches for money, and these addresses do not move.
    queryKey: ["arc", "deposit-addresses"],
    queryFn: fetchDepositAddresses,
    enabled,
    staleTime: 10 * 60_000,
    // A 503 here means "being set up"; one more try is worth it, three are not.
    retry: 1,
  })
}

/** The address the way the store card prints it: enough of the head to recognise, the tail to check. */
export function pillAddress(a: string): string {
  return a.length > 26 ? `${a.slice(0, 18)}…${a.slice(-6)}` : a
}

export const OTHERS_NOTE = "Send USDC on the network named beside the address."
export const OTHERS_NOTE_SWEPT = `${OTHERS_NOTE} It moves to your balance on its own.`

/**
 * What the card shows, decided without React so it can be tested: the Arc
 * address (the server's, else the one the screen already has), the other
 * networks, the one line that names them before the row is opened, and the
 * line under the open rows.
 *
 * That last line says the money moves on its own only when every row names
 * its floor, because below the floor it does not move, and a promise with no
 * visible edge would be broken by the first small deposit.
 */
export function depositCardView(
  data: { arc: { address: string }; others: DepositNetworkAddress[] } | null,
  fallbackAddress: string,
): { arcAddress: string; others: DepositNetworkAddress[]; othersSummary: string; othersNote: string } {
  const fallback = EVM.test(fallbackAddress) ? fallbackAddress.toLowerCase() : fallbackAddress
  const arcAddress = data?.arc.address || fallback
  const others = data?.others ?? []
  const floored = others.length > 0 && others.every((o) => Boolean(o.minUsdc))
  return {
    arcAddress,
    others,
    othersSummary: networksSentence(others.map((o) => o.network)),
    othersNote: floored ? OTHERS_NOTE_SWEPT : OTHERS_NOTE,
  }
}

/** "Base", "Base and Solana", "Base, Ethereum and Solana": each network once, in the server's order. */
export function networksSentence(networks: string[]): string {
  const names: string[] = []
  for (const n of networks) if (!names.includes(n)) names.push(n)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
