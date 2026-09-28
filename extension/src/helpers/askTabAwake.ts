/**
 * THE PAGE BESIDE THE PANEL, WOKEN UP IF IT HAS TO BE.
 *
 * Everything a wallet account does from the side panel (connect, deposit,
 * trade, order, convert) is handed to the content script of the tab beside
 * it, because Phantom lives in web pages and never in the extension's own.
 * Chrome does not put an extension into tabs that were already open when it
 * was installed, and Poppin injects on navigation, so a tab opened earlier
 * has nobody listening until it reloads.
 *
 * Measured 2026-09-25: a new reader pressed Connect in the panel's funding
 * screen twelve times in six seconds and got "The page beside the panel did
 * not answer" every time, then left. The tab beside the panel had been
 * opened before the install.
 *
 * So a message that finds no receiver wakes the tab (the same injection
 * every navigation uses) and asks again, a few times, while the new
 * content script registers its listener. Only "no receiver" wakes it: a
 * page that answered, even with an error, is left alone, and an answer that
 * takes long (Phantom waiting on the reader) is not a missing receiver.
 */

export type TabAnswer = { res: unknown; noReceiver: boolean }

/** Chrome's words for a message that reached no listener in the tab. */
export function isNoReceiver(lastErrorMessage: string | undefined | null): boolean {
  return /Receiving end does not exist|Could not establish connection/i.test(lastErrorMessage ?? "")
}

export async function askTabAwake(opts: {
  ask: () => Promise<TabAnswer>
  wake: () => Promise<void>
  waitsMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}): Promise<unknown | undefined> {
  const first = await opts.ask()
  if (!first.noReceiver) return first.res
  try {
    await opts.wake()
  } catch {
    // A tab we could not wake answers the way it did before: not at all.
    return undefined
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (const ms of opts.waitsMs ?? [250, 500, 1000]) {
    await sleep(ms)
    const again = await opts.ask()
    if (!again.noReceiver) return again.res
  }
  return undefined
}
