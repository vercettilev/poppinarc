import { JUICE } from "~/theme/juice"
import { alpha, Box, CircularProgress, Typography } from "@mui/material"
import { useMemo } from "react"
import CustomInfiniteScroll from "~/components/CustomInfiniteScroll"
import EmptyState from "~/components/EmptyState"
import Post from "~/components/Post"
import Reply from "~/components/Reply"
import { useIsUpvoted } from "~/hooks-ui/useIsUpvoted"
import { useReplyUpvoted } from "~/hooks-ui/useReplyUpvoted"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { useUpvotedPosts } from "~/hooks/useUpvotedPosts"
import { useUserReplies } from "~/hooks/useUserReplies"
import { useWebsitePosts } from "~/hooks/useWebsitePosts"
import { ACCENT, FAINT } from "~/helpers/panelSurface"

/**
 * One feed, filtered — the profile's whole body.
 *
 * ── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────────
 * Five tabs: Posts, Reply, Upvotes, Followers, Following. Four fifths of the
 * page was hidden at any moment, and two of the five were lists of PEOPLE
 * sitting in a bar that otherwise switched between lists of POSTS. That is
 * the same fragmentation the page feed shed when Posts/Trades became one
 * feed — "neden bölelim fragmente edelim ki ürün arayüzlerini?" — applied to
 * the surface it was worst on.
 *
 * So: people moved out to a sheet (opened by the Followers/Following counts),
 * and everything that is a list of posts became ONE feed with a filter. `all`
 * is the default, and a trade receipt sits next to a post because they are
 * the same conversation.
 *
 * ── WHY THE FILTER IS PILLS AND NOT THE HEADER'S POPOVER ────────────────────
 * On the page feed the filter is a funnel icon: the feed there has one
 * obvious meaning and the filter is a refinement. Here the filter IS the
 * navigation that replaced the tab bar, so it has to be visible and it has to
 * show what is selected. Same values, different weight — deliberately.
 */

export type ProfileFeedKind = "all" | "posts" | "trades" | "replies" | "upvoted"

const KINDS: ReadonlyArray<readonly [ProfileFeedKind, string]> = [
  ["all", "All"],
  ["posts", "Posts"],
  ["trades", "Trades"],
  ["replies", "Replies"],
]

export function ProfileFeedFilter({
  kind,
  onChange,
  showUpvoted,
}: {
  kind: ProfileFeedKind
  onChange: (k: ProfileFeedKind) => void
  /** Likes are yours to review, not a stranger's to browse. */
  showUpvoted: boolean
}) {
  /**
   * "Likes", not "Upvoted" — and the KEY stays `upvoted`. The key is the
   * API's word: it names the query (useUpvotedPosts below), the enable
   * checks, the EmptyState branch and ultimately /users/upvoted-status. The
   * LABEL is the reader's word, and the product settled on "like" long ago —
   * notificationText collapses every upvote_* row to the kind "like" and
   * says "liked your reply" out loud. This tab and its empty state were the
   * last two places still saying "upvote" to a reader.
   */
  const options = showUpvoted ? [...KINDS, ["upvoted", "Likes"] as const] : KINDS

  /**
   * THE ROW FITS; IT DOES NOT SLIDE. This container was `overflowX: "auto"`
   * with `::-webkit-scrollbar { display: none }`, so at the panel's 320px
   * minimum the fifth segment simply lived off-screen with nothing on screen
   * to hint that it existed. Measured against the shipped face (Poppins-Bold
   * is what weight 700 of PoppinSans resolves to) at 12px, the five segments
   * needed 374.6px of a 318px budget — the 320px panel less the theme's 2px
   * hairline scrollbar. The rename buys only 21.4px of that, so the fit is
   * bought here instead: gap 6→4px and pill padding 12→8px per side bring
   * the row to 305.2px, 12.8px inside the budget, which the pills then
   * spend by sharing it (see `flex` below).
   *
   * `px: 2` does NOT move. It is what keeps this row's gutter flush with
   * ProfileHead above it, and there is no need to raid it.
   *
   * flexWrap is the valve below 320px: a second line is honest, a hidden
   * scrollbar is not.
   */
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: 0.5,
        px: 2,
        py: 1.25,
      }}
    >
      {options.map(([value, label]) => {
        const active = kind === value
        return (
          <Box
            key={value}
            component="button"
            onClick={() => onChange(value)}
            className="click-animation"
            sx={{
              // The segments SHARE the row rather than each hugging its own
              // label and pushing the last one off the edge — the same
              // equal-share shape the counts row directly above uses
              // (ProfileHead's four numbers: flex, minWidth:0, gap 0.5).
              //
              // "1 1 auto", not "1 1 0": an equal 54px share is narrower
              // than "Replies" needs (62.5px at this type step), so literal
              // equal flex clips two of the five at 320px. Growing from the
              // natural width spends the 12.8px of slack evenly and clips
              // nothing. whiteSpace:nowrap keeps a label on one line if the
              // row ever wraps.
              flex: "1 1 auto",
              minWidth: 0,
              whiteSpace: "nowrap",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              px: 1,
              py: "6px",
              borderRadius: "999px",
              color: active ? JUICE.onAccent : JUICE.text2,
              backgroundColor: active ? ACCENT : alpha("#FFFFFF", 0.06),
              border: `1px solid ${active ? ACCENT : alpha("#FFFFFF", 0.1)}`,
              transition: "background-color .14s ease-out, color .14s ease-out",
              "&:hover": {
                backgroundColor: active ? ACCENT : alpha("#FFFFFF", 0.12),
              },
            }}
          >
            {label}
          </Box>
        )
      })}
    </Box>
  )
}

export function ProfileFeed({
  userId,
  kind,
  isOwnProfile,
  scrollRef,
  onTip,
}: {
  userId: string
  kind: ProfileFeedKind
  isOwnProfile: boolean
  /** The tip door, threaded through: standing on somebody's profile
   *  admiring their calls is the most natural place to tip, and it was
   *  the one place the control was hidden. */
  onTip?: (data: {
    user: { id: string; username: string; display_name?: string; wallet_address?: string | null }
    postId: string
  }) => void
  /** The PAGE's scrolling element. The infinite-scroll observer must watch
   *  the box that actually scrolls; watching an inner box that does not
   *  meant the trigger was "visible" from frame one. */
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {

  const wantsPosts = kind === "all" || kind === "posts" || kind === "trades"

  const posts = useWebsitePosts({
    userId,
    limit: 10,
    enabled: wantsPosts,
    // The SERVER's definition of a trade (a post_transactions row), same
    // as the main feed — the old client filter read on_chain, a
    // client-supplied flag live code contradicts, so the two surfaces
    // disagreed about the same post. Full pages, one definition.
    kind: kind === "trades" ? "trades" : kind === "posts" ? "posts" : undefined,
  })
  const replies = useUserReplies({ userId, limit: 10, enabled: kind === "replies" })
  const upvoted = useUpvotedPosts({ userId, limit: 10, enabled: kind === "upvoted" })

  const { isPostUpvoted } = useIsUpvoted((wantsPosts ? posts.data : upvoted.data) as any)
  const { isPostUpvoted: isReplyUpvoted } = useReplyUpvoted(replies.data as any)

  /** Every author on screen, for badges and streaks — one bulk call, not one
   *  per row. Same shape the tabs used; the difference is it is written once
   *  here instead of five times. */
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    const eat = (u: any) => u?.id && ids.add(u.id)
    ;(posts.data as any)?.pages?.forEach((p: any) => p.data?.forEach((x: any) => eat(x.user)))
    ;(upvoted.data as any)?.pages?.forEach((p: any) => p.data?.forEach((x: any) => eat(x.user)))
    ;(replies.data as any)?.pages?.forEach((p: any) =>
      p.data?.forEach((x: any) => {
        eat(x.user)
        eat(x.post?.user)
      }),
    )
    return Array.from(ids)
  }, [posts.data, upvoted.data, replies.data])

  const { getOrganizationsForUser } = useBulkUserOrganizations(authorIds)
  const { data: streaks } = useUserStreaksByIds(authorIds)
  const streakOf = (id?: string) =>
    streaks?.find((s: any) => s.user_id === id)?.current_streak || 0

  const active = kind === "replies" ? replies : kind === "upvoted" ? upvoted : posts
  const pages = (active.data as any)?.pages ?? []

  const rows = useMemo(
    // Server-filtered now (kind rides the query and its cache key);
    // re-filtering here on on_chain was the bug being retired.
    () => pages.flatMap((p: any) => p.data ?? []),
    [pages],
  )

  const loading =
    kind === "replies"
      ? replies.isLoading
      : kind === "upvoted"
        ? upvoted.isLoading
        : posts.isLoading

  /**
   * A FILTER IS A RE-SORT, NOT A TELEPORT. Each kind is its own query, so
   * the first tap on Posts/Trades/Replies threw the rows the reader was
   * scanning into a spinner. When there are rows to keep, they stay -
   * dimmed while the new list answers - and only a truly empty view waits.
   */
  const fetching =
    kind === "replies"
      ? replies.isFetching
      : kind === "upvoted"
        ? upvoted.isFetching
        : posts.isFetching

  if (loading && !rows.length) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
        <CircularProgress size={22} sx={{ color: ACCENT }} />
      </Box>
    )
  }

  if (!rows.length) {
    // "Posts" and "Trades" are filters OF the post feed, so an empty result
    // there is a filter that matched nothing — not an empty profile. Saying
    // "no posts yet" would be a lie about the person.
    if (kind === "trades" || kind === "posts") {
      return (
        <Typography sx={{ textAlign: "center", py: 5, fontSize: 12.5, color: FAINT }}>
          Nothing here under this filter.
        </Typography>
      )
    }
    return (
      <EmptyState
        type={kind === "replies" ? "replies" : kind === "upvoted" ? "upvotes" : "posts"}
      />
    )
  }

  return (
    <Box
      sx={{
        px: "10px",
        pb: 3,
        opacity: fetching && !active.isFetchingNextPage ? 0.5 : 1,
        transition: "opacity .16s ease-out",
      }}
    >
      <CustomInfiniteScroll
        onLoadMore={() => void active.fetchNextPage()}
        hasMore={!!active.hasNextPage}
        isLoading={active.isFetchingNextPage}
        containerRef={scrollRef}
        loadingComponent={
          <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
            <CircularProgress size={20} sx={{ color: ACCENT }} />
          </Box>
        }
      >
        {kind === "replies"
          ? rows.map((reply: any) => (
              <Box key={reply.id} sx={{ pb: 2.5 }}>
                <Post
                  {...reply.post}
                  reply
                  isUpvoted={isReplyUpvoted(reply.post?.id)}
                  userStreak={streakOf(reply.post?.user?.id)}
                  userOrganizations={getOrganizationsForUser(reply.post?.user?.id)}
                  onTip={onTip}
                  isOwnProfile={false}
                />
                {/* The stem: this reply hangs off the post above it. */}
                <Box
                  sx={{
                    height: 18,
                    width: "1px",
                    ml: "20px",
                    my: "8px",
                    backgroundColor: alpha("#FFFFFF", 0.35),
                    borderRadius: "1px",
                  }}
                />
                <Reply
                  {...(reply as any)}
                  userOrganizations={getOrganizationsForUser(reply.user?.id)}
                />
              </Box>
            ))
          : rows.map((post: any) => (
              <Box key={post.id} data-post-id={post.id}>
                <Post
                  {...post}
                  isUpvoted={isPostUpvoted(post.id)}
                  userStreak={streakOf(post.user?.id)}
                  userOrganizations={getOrganizationsForUser(post.user?.id)}
                  transaction={post.post_transaction}
                  onTip={onTip}
                  isOwnProfile={isOwnProfile}
                />
              </Box>
            ))}
      </CustomInfiniteScroll>
    </Box>
  )
}
