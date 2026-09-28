/**
 * Is this failure a rate limit?
 *
 * Asked so a surface can say "give it a moment" instead of printing the
 * server's exception name at a reader. Reported live on 2026-09-24: the
 * panel's feed rendered "Error: ThrottlerException: Too Many Requests",
 * which names a Nest class and tells nobody anything.
 *
 * TWO SHAPES, because the answer arrives by two roads. Axios throws an
 * error carrying `response.status`; a fetch wrapper that rejects with a
 * plain object carries `status`. A helper that knew only one of them would
 * be right in half the panel and silently wrong in the other half.
 */
export function isRateLimited(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as {
    status?: unknown
    message?: unknown
    response?: { status?: unknown; data?: { message?: unknown } }
  }
  const code = e.response?.status ?? e.status
  if (code === 429) return true
  /* Last resort, and only for the exact words: the background relays some
     failures as a re-thrown Error whose message is all that survived the
     trip across the port. Matching loosely here would turn any sentence
     containing "limit" into a rate limit.
     BOTH PLACES THE TEXT CAN SIT. An axios rejection keeps the server's
     body at response.data.message and leaves the top-level message as
     "Request failed with status code 429"; reading only one of the two
     was caught by this helper's own spec. */
  const texts = [e.message, e.response?.data?.message]
  return texts.some(
    (t) => typeof t === "string" && /ThrottlerException|Too Many Requests/i.test(t),
  )
}
