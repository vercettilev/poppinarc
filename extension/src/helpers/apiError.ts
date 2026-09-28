/**
 * ONE HUMAN SENTENCE OUT OF WHATEVER THE API THREW.
 *
 * Measured live on the identity step: the reader saw
 *
 *   [ { "code": "too_small", "minimum": 3, "type": "string", "inclusive":
 *     true, "exact": false, "message": "Display name must be at least 3
 *     characters", "path": [ "display_name" ] } ]
 *
 * printed into the error banner, verbatim. That is not a near-miss of a
 * good message — the good message is INSIDE it, four keys deep.
 *
 * The chain that produces it: ZodPipe throws a ZodError, ZodFilter answers
 * `{ errors, message }` where `message` is ZodError.message (which is the
 * issue array, JSON-stringified), and the extension's background bridge
 * forwards `err.response.data.message` while dropping the structured
 * `errors` beside it. So by the time a screen catches anything, the only
 * thing left IS the JSON string, and every screen that renders
 * `error.message` renders a debugger's view of itself.
 *
 * Rather than teach each screen, this is the one place that knows: pull
 * the first issue's own message back out, and only fall back to a written
 * sentence when there is genuinely nothing to say.
 */

import { isRateLimited } from "./rateLimited"

/**
 * THE ONE FAILURE HERE THAT CLEARS ITSELF, so it gets its own sentence
 * rather than each caller's generic fallback. A reader told "couldn't
 * load, check your connection" will check their connection, find it fine,
 * and conclude the product is broken; the true answer is "wait a moment".
 *
 * Reported live 2026-09-24 from the panel's feed, which printed the class
 * name: "Error: ThrottlerException: Too Many Requests".
 */
export const RATE_LIMIT_SENTENCE =
  "Going a bit fast. Give it a moment and try again."

type ZodIssueish = {
  message?: unknown
  path?: unknown
}

/** "display_name" → "Display name" — for issues whose message is a bare
 *  "Required" and would otherwise name nothing at all. */
function fieldLabel(path: unknown): string | null {
  if (!Array.isArray(path) || path.length === 0) return null
  const key = path[0]
  if (typeof key !== "string" || !key) return null
  const words = key.replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function fromIssues(issues: unknown): string | null {
  if (!Array.isArray(issues) || issues.length === 0) return null
  const first = issues[0] as ZodIssueish
  const message = typeof first?.message === "string" ? first.message.trim() : ""
  if (!message) return null
  // "Required" on its own names nothing. Zod's other messages already
  // carry the field ("Display name must be at least 3 characters"), so
  // they are left exactly as the schema wrote them.
  if (/^required$/i.test(message)) {
    const label = fieldLabel(first.path)
    return label ? `${label} is required` : null
  }
  return message
}

/** Whatever a caught error carries as its top-level text. */
function rawMessage(e: unknown): string {
  const err = e as {
    message?: unknown
    response?: { data?: { message?: unknown; errors?: unknown } }
  }
  const data = err?.response?.data
  // The structured field first when a screen happens to have it — this is
  // the shape the bridge drops, but direct callers still see it.
  const fromData = fromIssues(data?.errors)
  if (fromData) return fromData
  if (typeof data?.message === "string") return data.message
  if (typeof err?.message === "string") return err.message
  return ""
}

/**
 * @param fallback what to say when the error carries nothing usable. Write
 *   it for the specific screen: "Could not save that" beats "Error".
 */
export function humanApiError(e: unknown, fallback: string): string {
  // Asked before the text is read, because a rate limit arrives as a status
  // on some paths and as a class name on others, and only one of those two
  // would ever survive the string checks below.
  if (isRateLimited(e)) return RATE_LIMIT_SENTENCE

  const raw = rawMessage(e).trim()
  if (!raw) return fallback

  // A JSON-stringified issue array (the case above), or any JSON payload
  // that turns out to hold the real sentence.
  if (raw.startsWith("[") || raw.startsWith("{")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Not JSON after all — it merely started with a bracket. Showing it
      // is still better than swallowing it, so fall through.
      return raw
    }
    return (
      fromIssues(parsed) ??
      (typeof (parsed as { message?: unknown })?.message === "string"
        ? ((parsed as { message: string }).message.trim() || fallback)
        : // Valid JSON with nothing sayable in it. Never hand a reader a brace.
          fallback)
    )
  }

  // Server-speak that tells a reader nothing.
  if (/^(unknown error|internal server error|bad request)$/i.test(raw)) {
    return fallback
  }
  return raw
}
