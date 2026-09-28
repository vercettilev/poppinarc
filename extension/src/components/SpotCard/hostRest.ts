/**
 * PER-HOST FATIGUE for the auto-opened card.
 *
 * The certainty gate answers "are we RIGHT about the page?" and stays
 * untouched. This answers a different question: "does this reader on this
 * host WANT the full card?" A reader who collapsed the auto-opened card
 * twice on dexscreener without trading has answered it, and meeting the
 * full card on every later token page anyway is the interruption everybody
 * hates wearing a certainty costume.
 *
 * Opening the tab back up, or trading, resets the host: both are the
 * reader saying the card earned its place again.
 */
const KEY = "poppin_card_rest_hosts"
const REST_AFTER = 2

type Book = Record<string, number>

async function read(): Promise<Book> {
  try {
    const got = await chrome.storage.local.get(KEY)
    const v = got?.[KEY]
    return v && typeof v === "object" ? (v as Book) : {}
  } catch {
    return {}
  }
}

async function write(book: Book): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: book })
  } catch {
    // Storage unavailable: the card simply keeps today's behaviour.
  }
}

/** Has this host collapsed the auto-open enough times to rest it? */
export async function hostPrefersTab(host: string): Promise<boolean> {
  const book = await read()
  return (book[host] ?? 0) >= REST_AFTER
}

/** The reader collapsed an AUTO-OPENED card without trading. */
export async function noteAutoOpenCollapsed(host: string): Promise<void> {
  const book = await read()
  book[host] = (book[host] ?? 0) + 1
  await write(book)
}

/** The reader pulled the card open, or traded: the host is welcome again. */
export async function noteCardWanted(host: string): Promise<void> {
  const book = await read()
  if (book[host] === undefined) return
  delete book[host]
  await write(book)
}
