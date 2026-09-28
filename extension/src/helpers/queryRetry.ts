/**
 * WHEN ASKING AGAIN CAN HELP, AND WHEN IT CANNOT.
 *
 * React Query's default is `retry: 3`, and `new QueryClient()` took it. The
 * backend allows 30 requests a minute per user across every route, so the
 * moment a reader crossed that line every mounted query answered 429 and
 * then asked three more times. A dozen queries turned one rate limit into
 * roughly fifty requests into an already-empty bucket, and the panel could
 * not climb out of a state its own recovery was maintaining.
 *
 * A 4xx is an ANSWER. Rate limited, session expired, not found, malformed —
 * the server looked and told us. Asking again with the same request gets
 * the same reply and costs the budget that would have let the next real
 * request through. A 5xx or a dead socket is different: nobody answered, so
 * a second try is a fresh question.
 */
export function isClientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { status?: unknown; response?: { status?: unknown } }
  const code = e.response?.status ?? e.status
  return typeof code === "number" && code >= 400 && code < 500
}

/** Two tries for anything the server never answered; none for 4xx. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (isClientError(err)) return false
  return failureCount < 2
}
