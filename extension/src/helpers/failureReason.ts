/**
 * WHAT WENT WRONG, IN WORDS, NEVER "[object Object]".
 *
 * A failure reaches us in three shapes and none of them is reliably an
 * Error: the background bridge does `throw response.error` (a plain
 * object), Nest answers a refusal as `{statusCode, message, error}`, and
 * axios wraps the whole thing again. `String()` on any of those prints
 * "[object Object]", which is what the owner saw on screen and then again
 * in chrome://extensions on the same afternoon.
 *
 * Chrome's extension error page flattens a second console argument to a
 * string, so passing the object as `console.error(line, detail)` loses it
 * too. The reason has to be IN the line.
 *
 * Order matters: an Error's own message first, then the field names our
 * server and our bridge actually use, then a last-resort serialisation.
 * The final fallback is a sentence rather than a shrug, because reaching
 * it means we genuinely do not know.
 */
export function failureReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>
    // Axios keeps the server's body one level down.
    const body = (o["response"] as Record<string, unknown> | undefined)?.["data"]
    for (const source of [body, o]) {
      if (source && typeof source === "object") {
        const s = source as Record<string, unknown>
        for (const k of ["message", "error", "detail"]) {
          const v = s[k]
          if (typeof v === "string" && v) return v
        }
      }
    }
    try {
      const j = JSON.stringify(err)
      if (j && j !== "{}") return j
    } catch {
      // Circular, or something that refuses to serialise. Fall through.
    }
  }
  if (typeof err === "string" && err) return err
  return "Refused, with no reason given"
}
