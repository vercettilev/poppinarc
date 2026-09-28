/** @jsxImportSource preact */
/*
 * THE PRAGMA ABOVE IS LOAD-BEARING — same reason as SpotCard.tsx, mount.tsx
 * and TradePanel.tsx. Preact renders this tree while the rest of the app
 * compiles JSX with React's runtime; without the pragma every child is
 * silently dropped and render() succeeds into an empty shadow root.
 */
import { useCallback, useRef, useState } from "preact/hooks"
import {
  postText,
  relTime,
  type CardPost,
  type CardReply,
  type PostOutcome,
  type SpotCardHandlers,
} from "./SpotCard"
import { ChipGlyphIcon } from "../ChipGlyphIcon"
import {
  CHIP_GLYPH_SIZE,
  GLYPH_LIKE_FILLED,
  GLYPH_LIKE_OUTLINE,
  GLYPH_REPLY,
} from "../chipGlyphs"

/**
 * The page's conversation: the feed, one thread deep, and the write path.
 *
 * ── WHY A HOOK AND A COMPONENT, NOT JUST A COMPONENT ────────────────────────
 * The panel came out cleanly because its state belonged to nobody else. This
 * does not: `draft`, `posting` and `postError` are shared by TWO composers —
 * the one inside the feed and the one on the card face, which is a different
 * view entirely. Extracting only the feed would have left that state behind
 * and needed twenty-odd props to reach back for it, or split it in two.
 *
 * Splitting it in two is exactly the mistake this whole refactor exists to
 * undo. So the state moves once, into `useConversation`, and BOTH render
 * sites read the same object: `<Conversation>` for the full view, and the
 * card face's mini-composer via the same returned handle. One state, two
 * places to see it, no copy to fall behind.
 */

export interface ConversationApi {
  /** Server list plus the reader's own not-yet-confirmed sentence. */
  feed: readonly CardPost[]
  draft: string
  setDraft: (v: string) => void
  posting: boolean
  postError: PostOutcome | null
  /** Send the open thread's reply, with the same in-flight and failure
   *  vocabulary the feed composer uses. */
  submitReply: () => Promise<void>
  clearError: () => void
  /** Send the draft. Resolves once the write and its re-read have settled. */
  submitPost: () => Promise<void>
  thread: CardPost | null
  replies: readonly CardReply[]
  loadingThread: boolean
  openThread: (p: CardPost) => Promise<void>
  /** Leaving the thread: drops the reply draft with it. */
  closeThread: () => void
  likedNow: (p: CardPost) => boolean
  toggleLike: (p: CardPost) => void
  /** Leaving the conversation entirely — clears the error, keeps the draft. */
  reset: () => void
}

export function useConversation(opts: {
  posts?: readonly CardPost[]
  handlers: SpotCardHandlers
  me?: { name: string; photoUrl: string | null } | null
  /** Called when a post lands, so the card can show the feed it went into. */
  onPosted: () => void
  /** Called when a thread opens, so the card can switch view. */
  onThreadOpened: () => void
}): ConversationApi {
  const { posts, handlers, me, onPosted, onThreadOpened } = opts

  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<PostOutcome | null>(null)
  /** The post whose thread is open. One level deep, deliberately: a card is
   *  not a place to navigate, and anything deeper is what the panel is for. */
  const [thread, setThread] = useState<CardPost | null>(null)
  const [replies, setReplies] = useState<readonly CardReply[]>([])
  const [loadingThread, setLoadingThread] = useState(false)

  /**
   * Posts this reader has voted on, for this card's lifetime.
   *
   * THE SERVER DOES NOT ALWAYS TELL US. `/website-post/` gained `isUpvoted`
   * on 2026-08-19, but an older backend still answers without it, and then
   * `upvoted` is false for everything. A Set could only ever say "liked", so
   * un-liking a post the server reported as liked had nowhere to record
   * itself and the button stuck after one press. A Map of overrides holds
   * both directions.
   */
  const [votedIds, setVotedIds] = useState<ReadonlyMap<string, boolean>>(new Map())
  /** Presses already in flight, so a double-click is one vote. */
  const votingRef = useRef<Set<string>>(new Set())

  /**
   * The reader's own post, shown the instant the server accepts it.
   *
   * The house rule is re-read-never-splice, and it is right about OTHER
   * people's posts: the server owns what the conversation is. It is wrong
   * about the sentence you just wrote and watched be accepted — there the
   * rule produced the exact failure it exists to prevent, a writer pressing
   * Post and seeing absolutely nothing change while the refetch flies. This
   * echo is cleared the moment a real list arrives, so the server still gets
   * the last word; it just no longer gets the only word.
   */
  const [echo, setEcho] = useState<readonly CardPost[]>([])
  const postsSeen = useRef(posts)
  /**
   * Retired DURING RENDER, not in an effect. An effect runs after paint, so
   * there would be one frame showing the echo AND the server's copy of the
   * same sentence — the writer seeing their post twice, which is a worse lie
   * than not showing it at all. Deriving here means the handoff is atomic:
   * the frame that has the server's list has already dropped the echo.
   */
  let live = echo
  if (posts !== postsSeen.current) {
    postsSeen.current = posts
    if (echo.length) {
      live = []
      setEcho(live)
    }
  }
  const feed = live.length ? [...live, ...(posts ?? [])] : posts ?? []

  const likedNow = useCallback(
    (p: CardPost): boolean => (votedIds.has(p.id) ? votedIds.get(p.id)! : p.upvoted),
    [votedIds],
  )

  const toggleLike = useCallback(
    (p: CardPost) => {
      // ONE like, and it TOGGLES. An earlier guard refused every press after
      // the first, which stopped the count inflating and also made a like
      // permanent — a reader who tapped by accident was stuck with it. The
      // in-flight ref is the only thing that should block a press; whether
      // they already like it decides the DIRECTION, not whether it is allowed.
      if (votingRef.current.has(p.id)) return
      const already = votedIds.has(p.id) ? votedIds.get(p.id)! : p.upvoted
      votingRef.current.add(p.id)
      setVotedIds((prev) => new Map(prev).set(p.id, !already))
      void Promise.resolve(handlers.onVote?.(p.id, already))
        .then((ok) => {
          if (ok === false) {
            // The server refused. Put it back the way it was rather than
            // leaving the reader looking at a like — or an unlike — that
            // never happened.
            setVotedIds((prev) => new Map(prev).set(p.id, already))
          }
        })
        .finally(() => votingRef.current.delete(p.id))
    },
    [handlers, votedIds],
  )

  /**
   * Send the draft, and SHOW what happened.
   *
   * Every composer routes through here so posting means the same thing from
   * anywhere. On success the card opens the conversation with the new line
   * already in it — the reader watches their sentence become a row, which is
   * the whole confirmation they were owed and never got.
   */
  const submitPost = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || posting || !handlers.onPost) return
    // What the conversation was before we sent. If a new list has landed by
    // the time this resolves, the parent already re-read and the echo would
    // not be covering a gap — it would be printing the reader's sentence a
    // SECOND time under a different id. (That is not hypothetical: the flow
    // awaits its own refetch and calls setPosts before onPost resolves, so
    // the no-gap case is the common one and the duplicate was the default.)
    const before = postsSeen.current
    setPosting(true)
    const outcome = await handlers.onPost(text)
    setPosting(false)
    if (outcome.kind !== "ok") {
      setPostError(outcome)
      return
    }
    setDraft("")
    setPostError(null)
    if (postsSeen.current === before) {
      setEcho([
        {
          // Local-only id. The server's list replaces this row wholesale the
          // moment it lands, so this never has to match anything.
          id: `echo-${text.length}-${text.slice(0, 12)}`,
          text,
          author: me?.name ?? "you",
          authorId: "",
          upvotes: 0,
          upvoted: false,
          replyCount: 0,
        },
      ])
    }
    onPosted()
    handlers.onPosts?.()
  }, [draft, posting, handlers, me, onPosted])

  const openThread = useCallback(
    async (p: CardPost) => {
      setThread(p)
      onThreadOpened()
      setDraft("")
      setLoadingThread(true)
      setReplies((await handlers.onOpenThread?.(p.id)) ?? [])
      setLoadingThread(false)
    },
    [handlers, onThreadOpened],
  )

  /**
   * THE REPLY GOES THROUGH THE SAME DOOR AS THE POST.
   *
   * The reply button used to call handlers.onReply straight from the JSX,
   * which walked around this state machine entirely: `posting` never went
   * true so the button never said it was working, and `postError` was never
   * set so a failed reply showed the reader NOTHING - their sentence sat in
   * the box and the thread did not change, which reads as "the button is
   * broken" rather than "it did not send".
   *
   * The two composers share `draft`, `posting` and `postError` precisely so
   * they cannot disagree about what sending and failing look like. This one
   * was the exception, and being the exception is what made it silent.
   */
  const submitReply = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || posting || !handlers.onReply || !thread) return
    setPosting(true)
    const outcome = await handlers.onReply(thread.id, text)
    setPosting(false)
    if (outcome.kind !== "ok") {
      setPostError(outcome)
      return
    }
    setDraft("")
    setPostError(null)
    // Re-read: the server decides what the thread is.
    setLoadingThread(true)
    setReplies((await handlers.onOpenThread?.(thread.id)) ?? [])
    setLoadingThread(false)
  }, [draft, posting, handlers, thread])

  const closeThread = useCallback(() => {
    setThread(null)
    setReplies([])
    setDraft("")
    setPostError(null)
  }, [])

  const reset = useCallback(() => setPostError(null), [])
  const clearError = useCallback(() => setPostError(null), [])

  return {
    feed,
    draft,
    setDraft,
    posting,
    postError,
    clearError,
    submitPost,
    submitReply,
    thread,
    replies,
    loadingThread,
    openThread,
    closeThread,
    likedNow,
    toggleLike,
    reset,
  }
}

/** The message under a failed write. Shared so the two composers cannot
 *  disagree about what a failure means. */
export function PostError({
  error,
  verb,
}: {
  error: PostOutcome | null
  verb: "post" | "reply"
}) {
  if (!error) return null
  return (
    <div className="post-err">
      {error.kind === "signed_out"
        ? verb === "reply"
          ? "Sign in to reply"
          : "Sign in to post"
        : error.kind === "failed" && error.message
          ? error.message
          : verb === "reply"
            ? "Couldn't send that — try again"
            : "Couldn't post that — try again"}
    </div>
  )
}

export function Conversation({
  c,
  handlers,
  postHead,
  postBody,
}: {
  c: ConversationApi
  handlers: SpotCardHandlers
  /** The row above a post's text. Passed in rather than duplicated: the
   *  thread's opening post kept its own older copy once, and every
   *  improvement to the feed row missed it for weeks. */
  postHead: (p: CardPost) => preact.JSX.Element
  /** The whole post, not just its words: a trade receipt draws a door. */
  postBody: (p: CardPost) => preact.JSX.Element
}) {
  return (
    <div data-posts className="posts">
      {c.thread ? (
        /* ── One thread, one level deep. Its way out is the header's ←,
              same as everywhere else. ─────────────────────────────────── */
        <>
          <div className="post post-head">
            {postHead(c.thread)}
            {postBody(c.thread)}
          </div>

          {c.loadingThread && <div className="post-empty">Loading…</div>}
          {!c.loadingThread && c.replies.length === 0 && (
            <div className="post-empty">No replies yet.</div>
          )}
          {c.replies.map((r) => (
            <div key={r.id} className="post reply">
              {/* The same head row as a post. This was a name and a
                  sentence jammed into one line, and the moment the
                  author's right margin moved into the head row it
                  rendered as "Levreply" — two words with nothing
                  between them. A reply is a post with a smaller voice,
                  not a different object. */}
              <div className="post-head-row">
                <span
                  className="post-ava"
                  aria-hidden="true"
                  style={
                    r.avatarUrl
                      ? {
                          backgroundImage: `url(${r.avatarUrl})`,
                          backgroundSize: "cover",
                        }
                      : undefined
                  }
                >
                  {r.avatarUrl ? "" : r.author.charAt(0).toUpperCase()}
                </span>
                <span className="post-author">{r.author}</span>
                <span className="post-when">{relTime(r.createdAt)}</span>
              </div>
              <span className="post-text">{r.text}</span>
            </div>
          ))}

          <div className="composer">
            <input
              type="text"
              data-draft
              placeholder="Reply…"
              value={c.draft}
              disabled={c.posting}
              onInput={(e: { target: EventTarget | null }) => {
                c.setDraft((e.target as HTMLInputElement).value)
                c.clearError()
              }}
            />
            <button
              data-act="post"
              disabled={c.posting || c.draft.trim().length === 0}
              onClick={() => void c.submitReply()}
            >
              {c.posting ? "…" : "Reply"}
            </button>
          </div>
          <PostError error={c.postError} verb="reply" />
        </>
      ) : (
        /* ── The feed. Its way out is the header's ←. ──────────────── */
        <>
          {c.feed.length === 0 && (
            <div className="post-empty">Be the first to say something here.</div>
          )}
          {c.feed.map((p) => (
            <div key={p.id} className="post">
              {postHead(p)}
              {postBody(p)}
              <div className="post-acts">
                <button
                  className="chip-act"
                  data-act="vote"
                  aria-pressed={c.likedNow(p) ? "true" : "false"}
                  aria-label={c.likedNow(p) ? "Unlike" : "Like"}
                  onClick={() => c.toggleLike(p)}
                >
                  {/* Empty until you press it, then full — the same pair of
                      states the panel's like chip carries, from the same two
                      descriptors, so the two surfaces cannot drift apart on
                      the one control a reader presses most. */}
                  <ChipGlyphIcon
                    glyph={c.likedNow(p) ? GLYPH_LIKE_FILLED : GLYPH_LIKE_OUTLINE}
                    size={CHIP_GLYPH_SIZE}
                  />
                  {/* HIDDEN AT ZERO, matching the side panel — which was
                      right about this and the card was not. A row of
                      "0 0" on every post reads as "nobody cared", and on
                      a young product that is both true and not worth
                      saying. The number appears with the first vote. */}
                  {(() => {
                    const liked = c.likedNow(p)
                    const n =
                      p.upvotes +
                      (liked && !p.upvoted ? 1 : 0) -
                      (!liked && p.upvoted ? 1 : 0)
                    return n > 0 ? <span className="num">{n}</span> : null
                  })()}
                </button>
                <button
                  className="chip-act"
                  data-act="thread"
                  aria-label="Open replies"
                  onClick={() => void c.openThread(p)}
                >
                  <ChipGlyphIcon glyph={GLYPH_REPLY} size={CHIP_GLYPH_SIZE} />
                  {p.replyCount > 0 && <span className="num">{p.replyCount}</span>}
                </button>
              </div>
              {p.hiddenFromOthers && (
                <div className="post-hidden">
                  Only you can see this. It looked like spam to us.
                </div>
              )}
            </div>
          ))}

          <div className="composer">
            <input
              type="text"
              data-draft
              placeholder="Say something…"
              value={c.draft}
              disabled={c.posting}
              onInput={(e: { target: EventTarget | null }) => {
                c.setDraft((e.target as HTMLInputElement).value)
                c.clearError()
              }}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") void c.submitPost()
              }}
            />
            <button
              data-act="post"
              disabled={c.posting || c.draft.trim().length === 0}
              onClick={() => void c.submitPost()}
            >
              {c.posting ? "…" : "Post"}
            </button>
          </div>
          <PostError error={c.postError} verb="post" />

          {/* Anything past a glance belongs in the panel, where a thread
              has room and a link looks like a link. */}
          {c.feed.length > 0 && (
            <button
              className="link"
              data-act="open-panel"
              // The label says conversation, so the door goes to the FEED,
              // scoped to this page — not to the profile the old shared
              // handler landed every door on.
              onClick={() => handlers.onOpenPanel?.("feed")}
            >
              Open in Poppin →
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Kept so `postText` is reachable from here without a second import path. */
export { postText }
