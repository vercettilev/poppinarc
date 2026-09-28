import { JUICE } from "~/theme/juice"
import { humanApiError } from "~/helpers/apiError"
import { alpha, Box, CircularProgress, Fab, styled, Typography, useTheme } from "@mui/material"
import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useMemo, useRef, useState } from "react"
import { useIsUpvoted } from "~/hooks-ui/useIsUpvoted"
import { useUserStreaks } from "~/hooks-ui/useUserStreaks"
import { useWebsitePosts } from "~/hooks/useWebsitePosts"
import { useWebsitePostView } from "~/hooks/useWebsitePostView"
import { useEnvironmentStore } from "~/store/useAppConfigStore"
import { ConsensusChip } from "~/components/ConsensusChip"
import { stripQueryParams } from "~/helpers/urlHelper"
import { PageAssetStrip } from "~/components/PageAssetStrip"
import { WinsRail } from "~/components/WinsRail"
import { CAP } from "~/config/edition"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useFilterStore } from "~/store/useFilterStore"
import { useSortStore } from "~/store/useSortStore"
import { useUIStore } from "~/store/useUIStore"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
// Regular imports
import CreatePost from "~/components/CreatePost"
import CustomInfiniteScroll from "~/components/CustomInfiniteScroll"
import Post from "~/components/Post"
import PostDetailView from "./PostDetailView"
import { TipDialog } from "./wallet/TipDialog"

// Import icons directly since they're likely small and used immediately
import { useLocation } from "react-router"
import { ArrowUpIcon } from "~/components/icons"
import ProfileDetailView from "./ProfileDetailView"


const ScrollableDiv = styled(Box)(() => ({
  zIndex: 1,
  paddingTop: "10px",
  paddingRight: "10px",
  borderRadius: "10px",
  overflowY: "auto",
  scrollbarWidth: "thin",
  scrollbarColor: `${alpha("#FFFFFF", 0.18)} transparent`,
  "&::-webkit-scrollbar": { width: 2 },
  "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: alpha("#FFFFFF", 0.18),
    borderRadius: 2,
  },
}))

export default function Comment() {
  const { currentUrl } = useCurrentUrlStore()
  const { isDomainPost } = useUIStore()
  const { sort } = useSortStore()
  const { orderBy, feedKind } = useFilterStore()
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  const [showTipDialog, setShowTipDialog] = useState(false)
  const [tipData, setTipData] = useState<{
    user: {
      id: string
      username: string
      display_name?: string
      wallet_address?: string | null
    }
    postId: string
  } | null>(null)

  const location = useLocation()

  const currentDomainValue = useMemo(() => {
    try {
      if (currentUrl) {
        const url = new URL(currentUrl)
        const hostname = url.hostname
        return hostname
      }
    } catch (error) {
      console.error("Error getting current domain value", error)
    }
    return ""
  }, [currentUrl])

  const passedUrl = useMemo(() => {
    return sort  === "timeline"
    ? null : isDomainPost
      ? currentDomainValue
      : sort === "currentUrl"
      ? decodeURIComponent(currentUrl)
      : null
  }, [isDomainPost, currentDomainValue, currentUrl, sort])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useWebsitePosts({
    isDomainPost,
    limit: 10,
    website_url: passedUrl || undefined,
    sort: {
      field:
        orderBy === "newest" || orderBy === "oldest" ? "created_at" : "upvotes",
      order: orderBy === "newest" || orderBy === "most_liked" ? "DESC" : "ASC",
    },
    // The Trades/Posts choice rides the QUERY now. Filtering the loaded
    // pages client-side used on_chain (a client-supplied flag live code
    // contradicts) and could thin a 10-row page to zero while hasNextPage
    // said otherwise. The server decides by the receipt row instead.
    kind: feedKind === "all" ? undefined : feedKind,
  })

  const { environment } = useEnvironmentStore()

  const totalPosts = useMemo(() => {
    return (data as any)?.pages.reduce((acc: number, page: any) => acc + page.data.length, 0) || 0
  }, [data])

  const hasNoPosts = (data as any)?.pages[0]?.data.length === 0

  const defaultPostsData = data ?? { pages: [] as any[], pageParams: [] }
  const { isPostUpvoted } = useIsUpvoted(defaultPostsData as any)
  const { getUserStreak } = useUserStreaks(defaultPostsData as any)
  const { mutateAsync: viewMutateAsync } = useWebsitePostView()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Extract unique user IDs from posts for bulk organization fetching
  const userIds = useMemo(() => {
    const uniqueUserIds = new Set<string>()
    defaultPostsData.pages.forEach(page => {
      (page as any).data?.forEach((post: any) => {
        if (post.user?.id) {
          uniqueUserIds.add(post.user.id)
        }
      })
    })
    return Array.from(uniqueUserIds)
  }, [defaultPostsData])

  // Fetch organization data for all post users
  const { data: userOrganizations, getOrganizationsForUser } = useBulkUserOrganizations(userIds)

  const theme = useTheme()

  const {userId, username, postId} = location.state || {}

  const havePaddingLeft = !userId && !username && !postId


  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    /**
     * THE SCROLL PATH IS FOR SCROLLING. This handler used to do a
     * querySelectorAll + getBoundingClientRect sweep AND a
     * chrome.storage.local.get - cross-process IPC - on EVERY scroll tick,
     * on the one surface whose entire job is buttery scrolling. The seen
     * set is hydrated once; the sweep is a 300ms trailing throttle; storage
     * is write-behind and capped so it cannot grow without bound.
     */
    const seen = new Set<string>()
    let hydrated = false
    window.chrome?.storage?.local.get("viewedPosts", (result) => {
      const stored = result?.viewedPosts
      if (Array.isArray(stored)) for (const id of stored) seen.add(String(id))
      hydrated = true
    })

    const sweep = () => {
      const postElements = container.querySelectorAll("[data-post-id]")
      if (!postElements.length || !hydrated) return
      const containerRect = container.getBoundingClientRect()
      const fresh: string[] = []
      postElements.forEach((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
          const id = el.getAttribute("data-post-id")
          if (id && !seen.has(id)) fresh.push(id)
        }
      })
      if (!fresh.length) return
      for (const id of fresh) seen.add(id)
      void viewMutateAsync({ ids: fresh })
        .then(() => {
          // Last 500 ids: enough to dedupe a session, bounded forever.
          window.chrome?.storage?.local.set({
            viewedPosts: [...seen].slice(-500),
          })
        })
        .catch((error) => {
          for (const id of fresh) seen.delete(id)
          console.error("Failed to send view posts", error)
        })
    }

    let sweepTimer: ReturnType<typeof setTimeout> | undefined
    const handleScroll = () => {
      setShowScrollToTop(container.scrollTop > 200)
      clearTimeout(sweepTimer)
      sweepTimer = setTimeout(sweep, 300)
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    // Trigger initial check
    handleScroll()

    return () => {
      clearTimeout(sweepTimer)
      container.removeEventListener("scroll", handleScroll)
    }
  }, [data, viewMutateAsync])

  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      })
    }
  }

  const handleOpenTip = (data: { user: { id: string; username: string; display_name?: string; wallet_address?: string | null }; postId: string }) => {
    setTipData(data)
    setShowTipDialog(true)
  }

  const handleCloseTip = () => {
    setShowTipDialog(false)
    setTipData(null)
  }

  if (isError) {
    /* THE SERVER'S EXCEPTION NAME IS NOT A SENTENCE. This printed
       "Error: ThrottlerException: Too Many Requests" into the panel, which
       tells a reader nothing they can act on and reads as a crash. A rate
       limit is the one failure here that ends by itself, so it says so. */
    return (
      <Box sx={{ p: 3, textAlign: "center", color: theme.palette.tetriary.contrastText }}>
        {humanApiError(error, "Couldn't load the feed. Check your connection and try again.")}
      </Box>
    )
  }


  const endMessage = (
    <Box
      sx={{ textAlign: "center", p: 2, color: theme.palette.tetriary.contrastText }}
    >
      <Typography variant="body2">
        You've seen all posts
      </Typography>
      {/* A DOOR WHERE THE LOOP ENDED. On a page-scoped feed this line is
          two posts away, and "I finished" was answered with silence. One
          quiet exit to the wider room; hidden when already there. */}
      {sort !== "timeline" && (
        <Typography
          onClick={() => useSortStore.getState().setSort("timeline")}
          sx={{
            mt: 1,
            fontSize: 12.5,
            fontWeight: 700,
            color: "#68C6FF",
            cursor: "pointer",
          }}
        >
          See the global feed →
        </Typography>
      )}
    </Box>
  )

  return (
    // A COLUMN THAT FITS, instead of one that guesses. See ScrollableDiv
    // below for what the guess cost.
    <Box
      sx={{
        pl: havePaddingLeft ? "10px" : "0px",
        position: "relative",
        width: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
   

        {sort === "currentUrl" &&
          !(location.state?.userId || location.state?.username || location.state?.postId) && (
            <>
              <PageAssetStrip currentUrl={currentUrl} />
              {/* Second on the screen, exactly where Fomo puts its own —
                  after what YOU have, before what the room is saying. It
                  renders nothing until enough people have opted in for it
                  to be a reel rather than one name repeated. */}
              {CAP.social && <WinsRail />}
              {/* The room's hour, one pill: tapping hands the mint to the
                  strip above through the launch store (no side — the strip
                  FOCUSES the token; its own Buy is one tap further, which
                  is as pushy as an aggregate should ever be). Renders
                  nothing for quiet rooms and under the server's floor.
                  THE ROOM'S NAME IS THE STRIPPED URL: receipts are filed
                  under stripQueryParams(url), so asking with a raw
                  utm-bearing address matched zero rows on exactly the
                  pages the feed showed trades for. Domain mode passes a
                  bare hostname that can never match a filed URL — the
                  chip stays down there rather than asking a question with
                  no possible answer. */}
              {!isDomainPost && CAP.social && (
                <ConsensusChip
                  url={passedUrl ? stripQueryParams(passedUrl) : null}
                />
              )}
            </>
          )}

        {sort === "currentUrl" &&  !(location.state?.userId || location.state?.username || location.state?.postId) && (
          <motion.div
            initial={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            style={{ overflow: "hidden", zIndex: 1, paddingRight: "10px"}}
          >
            <CreatePost />
          </motion.div>
        )}

 
        <>

          <PostDetailView />
          <ProfileDetailView />
          <ScrollableDiv
            id="scrollableDiv"
            ref={scrollContainerRef}
            sx={{
              zIndex: 1,
              paddingTop: sort !== "timeline" ? "10px" : "0px",
              paddingRight: totalPosts < 3 ? "10px" : "0px",
              borderRadius: "10px",
              /**
               * IN THE PANEL THE FEED TAKES WHAT IS LEFT — flex:1 + minHeight:0,
               * no arithmetic.
               *
               * This said `calc(100vh - 200px)`, and the 200 was measured
               * against a header stack that has since changed twice: the
               * ActionBar row moved into the filter popover, and the trade
               * card arrived above the composer. The column ended up ~110px
               * taller than the panel, which pushed the HEADER off the top —
               * reported as "üst kısma ulaşamıyorum, hiçbir farklı ekrana
               * ulaşamıyorum", because every other screen is reached from
               * that header.
               *
               * A hard-coded viewport subtraction is a promise that nothing
               * above will ever change size. Nothing above ever stops
               * changing size. The content-script surface keeps its fixed
               * heights: it is docked at a size WE choose, so there the
               * number is a real constraint rather than a guess.
               */
              ...(environment === "sidepanel"
                ? { flex: 1, minHeight: 0 }
                : {
                    height:
                      environment === "contentScript"
                        ? sort !== "timeline" && !isDomainPost
                          ? "400px"
                          : "490px"
                        : sort === "timeline" || isDomainPost
                          ? "490px"
                          : window.innerWidth < 768
                            ? "calc(100svh - 140px)"
                            : "417.75px",
                  }),
              overflowY: "auto",
            }}
          >
            {hasNoPosts ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  color: "#FFFFFF",
                  height: "-webkit-fill-available",
                }}
              >
                {/* The glossy 3D "Be first to post!" ghost was the last
                    FOMO-era illustration in the feed — plastic highlights and
                    a hard drop shadow against a brand whose mark is flat.
                    The flat disc mark, dimmed, sits in the room instead of
                    on top of it. The old asset stays in the repo. */}
                <Box
                  component="img"
                  src="/icons/logo.png"
                  alt=""
                  sx={{ width: 84, height: 84, borderRadius: "50%", opacity: 0.55 }}
                />
                <Box
                  component="p"
                  sx={{
                    m: 0,
                    textAlign: "center",
                    fontSize: "20px",
                    fontWeight: 700,
                    fontFamily: "PoppinSans, sans-serif",
                    color: "#FFFFFF",
                  }}
                >
                  Nobody&apos;s said anything here yet.
                </Box>
                <Typography
                  variant="body2"
                  sx={{ textAlign: "center", color: JUICE.text2, mt: -1 }}
                >
                  Be the first — your post stays on this page.
                </Typography>
              </Box>
            ) : isLoading && !(data as any)?.pages?.length ? (
              /* A COLD FEED IS NOT A VOID. The first load routed into the
                 infinite-scroll's bottom loader, so opening the room meant
                 a dark empty column with a small spinner near the fold.
                 Three post-shaped skeletons hold the space instead. */
              <Box sx={{ px: 1.5, pt: 1.5 }}>
                {Array.from({ length: 3 }, (_, i) => (
                  <Box
                    key={`fsk-${i}`}
                    sx={{
                      borderRadius: "16px",
                      backgroundColor: "rgba(255,255,255,.035)",
                      p: 1.75,
                      mb: 1.25,
                      animation: "poppinFeedBreathe 1.6s ease-in-out infinite",
                      animationDelay: `${i * 110}ms`,
                      "@keyframes poppinFeedBreathe": {
                        "0%, 100%": { opacity: 0.45 },
                        "50%": { opacity: 0.8 },
                      },
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          backgroundColor: "rgba(255,255,255,.07)",
                        }}
                      />
                      <Box
                        sx={{
                          height: 10,
                          width: 120,
                          borderRadius: "999px",
                          backgroundColor: "rgba(255,255,255,.07)",
                        }}
                      />
                    </Box>
                    <Box
                      sx={{
                        height: 9,
                        width: "88%",
                        mt: 1.5,
                        borderRadius: "999px",
                        backgroundColor: "rgba(255,255,255,.06)",
                      }}
                    />
                    <Box
                      sx={{
                        height: 9,
                        width: "54%",
                        mt: 0.75,
                        borderRadius: "999px",
                        backgroundColor: "rgba(255,255,255,.05)",
                      }}
                    />
                  </Box>
                ))}
              </Box>
            ) : (
              <CustomInfiniteScroll
                onLoadMore={fetchNextPage}
                hasMore={!!hasNextPage}
                isLoading={isFetchingNextPage || isLoading} 
                containerRef={scrollContainerRef}
                loadingComponent={<Box sx={{display: "flex", justifyContent: "center", alignItems: "center", mt: 2, zIndex: 1}}><CircularProgress /></Box>}
              >
                {(data as any)?.pages.map((page: any, i: number) => (
                  <div key={i} style={{zIndex: 1}}>
                    {page.data
                      .map((post: any) => (
                      <div key={post.id} data-post-id={post.id} >
                        <Post
                          {...post}
                          isUpvoted={isPostUpvoted(post.id)}
                          userStreak={getUserStreak(post.user?.id)}
                          userOrganizations={getOrganizationsForUser(post.user?.id)}
                          onTip={handleOpenTip}
                          transaction={(post as any).post_transaction}
                        />
                      </div>
                    ))}
                  </div>
                ))}
                {!hasNextPage && !isFetchingNextPage && !isLoading && endMessage}
              </CustomInfiniteScroll>
            )}
          </ScrollableDiv>
        </>

      {/* Scroll to Top Button */}
      <AnimatePresence>
        {showScrollToTop && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 8,
              zIndex: 1000
            }}
          >
            <Fab
              size="small"
              color="primary"
              onClick={scrollToTop}
              sx={{
                width: "24px",
                height: "24px",
                minHeight: "24px",
                minWidth: "24px",
                maxHeight: "24px",
                maxWidth: "24px",
                backgroundColor: theme.palette.primary.main,
                color: "white",
                '&:hover': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.8),
                }
              }}
            >
              <ArrowUpIcon />
            </Fab>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tip Dialog */}
      <TipDialog
        open={showTipDialog}
        onClose={handleCloseTip}
        recipient={tipData?.user || null}
        postId={tipData?.postId}
      />

    </Box>
  )
}
