import { ReactNode, useState } from "react"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { shouldRetryQuery } from "~/helpers/queryRetry"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

// Dev-only: devtools is a ~40KB bundle that subscribes to every query,
// adding overhead to every cache write. In production we never want it
// shipped inside the content script that runs on every page. The guard
// is a boolean constant so Vite's dead-code elimination removes both the
// JSX and the import chain from prod bundles.
const IS_DEV = process.env.NODE_ENV !== "production"

/**
 * A 429 MUST NOT BE RETRIED, and until 2026-09-24 every one of them was.
 *
 * `new QueryClient()` with no options takes React Query's defaults, and one
 * of them is `retry: 3`. The backend allows 30 requests a minute per user
 * (THROTTLE_TTL/THROTTLE_LIMIT, one in-memory bucket for every route), so
 * the moment a reader crossed that line EVERY query in the panel answered
 * 429 and then asked three more times — four requests to learn the same
 * fact, from a dozen mounted queries at once, all of them landing in the
 * same empty bucket. The throttle stopped being a limit and became a
 * self-sustaining outage: the client's own recovery kept the bucket empty.
 *
 * Reported from a live panel on music.youtube.com, a site that rewrites its
 * URL on every track — and the feed's query is keyed on that URL, so a
 * listener skipping tracks opens a new query per skip. That is the trigger;
 * the retry storm is what turned it into a wall of red.
 *
 * So: nothing with a 4xx is ever retried. A rate limit, an expired session,
 * a bad request and a missing row are all answers, not accidents, and
 * asking again cannot change any of them. 5xx and network failures keep
 * their retries, because those genuinely do come and go.
 */
export default function RTKProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: shouldRetryQuery,
            /* Ten seconds of grace. The panel remounts its tree on every
               route change and React Query's default staleTime is 0, so
               every back-and-forth between two tabs was a fresh round of
               requests for data that had not moved. */
            staleTime: 10_000,
          },
          mutations: { retry: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={client}>
      {IS_DEV && (
        <ReactQueryDevtools
          client={client}
          initialIsOpen={false}
          position="right"
        />
      )}
      {children}
    </QueryClientProvider>
  )
}
