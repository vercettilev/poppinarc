/**
 * WAIT FOR THE SESSION, THEN SAY SO — ONCE, OR NEVER.
 *
 * The background announces a finished sign-in to the welcome tab and to every
 * chip on the page (EXTENSION_SIGNIN_COMPLETE). Whoever hears it immediately
 * asks the backend who they are, and that request gets its Authorization
 * header from `auth.currentUser` — so announcing before Firebase has handed
 * the session over produces a 401 and a reader routed somewhere they should
 * not be. The announcement has to mean "there is a session", not "a message
 * arrived".
 *
 * THE SIGNAL. `auth.currentUser` is set by the SDK, and onAuthStateChanged is
 * how it says so; that pair is all this takes, injected, because the rule is
 * worth testing and firebase in a service worker is not importable into a
 * spec. Note what is deliberately NOT used: lib/axios's whenAuthSettled
 * resolves on the first auth answer of the worker's life, which for a reader
 * who was signed out has already happened and was null — it would return
 * instantly and announce into the same emptiness.
 *
 * NO SESSION, NO WORD. The timeout ends the wait silently: a sign-in that
 * never completed must leave the Sign in button exactly where it was, because
 * that is the truth.
 */

export type Unsubscribe = () => void

export interface SessionReadyOptions {
  /** The session as it stands right now — non-null means there is one. */
  currentUser: () => unknown
  /** Firebase's observer, handed back as its unsubscribe. */
  subscribe: (onUser: (user: unknown) => void, onError: () => void) => Unsubscribe
  /** Long enough for a custom-token sign-in on a bad connection, and no longer. */
  timeoutMs: number
  /** Run exactly once, and only with a session in hand. */
  then: () => void
}

export function whenSessionReady(opts: SessionReadyOptions): void {
  if (opts.currentUser()) {
    opts.then()
    return
  }
  let done = false
  /* Declared before the subscription and assigned after it, because an
     observer is allowed to answer synchronously — and a stop() reaching for a
     `const` that is still being evaluated is a crash, in a message handler,
     on the sign-in path. */
  let unsubscribe: Unsubscribe = () => {}
  /* ONCE. onAuthStateChanged fires again on a token refresh and on a second
     sign-in, and the caller's side effect is a broadcast that moves a reader
     between screens — the second one would move them again from wherever
     they had got to. */
  const stop = (session: boolean) => {
    if (done) return
    done = true
    try {
      unsubscribe()
    } catch {
      // Unsubscribing twice is not worth a thrown error in a service worker.
    }
    clearTimeout(timer)
    if (session) opts.then()
  }
  // The timer FIRST, for the same reason, and because a subscription that
  // throws must not leave one running with nothing to cancel it.
  const timer = setTimeout(() => stop(false), opts.timeoutMs)
  try {
    unsubscribe = opts.subscribe(
      (user) => {
        // A null here is Firebase saying "still nobody", which is not news.
        if (user) stop(true)
      },
      // The observer's own error: there is no session to announce, and there
      // is not going to be one from this attempt.
      () => stop(false),
    )
  } catch {
    // An observer we cannot even open will not hand us a session. The caller
    // is a message handler on the sign-in path; it must not throw from here.
    stop(false)
  }
}
