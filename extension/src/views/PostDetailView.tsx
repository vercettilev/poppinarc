import { JUICE } from "~/theme/juice"
import { humanApiError } from "~/helpers/apiError"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import {
    Box,
    CircularProgress,
    IconButton,
    Typography,
    useTheme
} from "@mui/material"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import Post from "~/components/Post"
import TooltipWrapper from "~/components/TooltipWrapper"
import { useUpvotedStatus } from "~/hooks/useUpvotedStatus"
import { useUserStreaksByIds } from "~/hooks/useStreaks"
import { useWebsitePost } from "~/hooks/useWebsitePosts"
import { useBulkUserOrganizations } from "~/hooks/useBulkUserOrganizations"
import { useEnvironmentStore } from "~/store/useAppConfigStore"
import { useRouteStore } from "~/store/useRouteStore"

export default function PostDetailView() {

  const navigate = useNavigate()

  const theme = useTheme()


  const location = useLocation()



  /**
   * Route param FIRST-CLASS, state as the fast path - the profile's bug 1,
   * fixed here too: a plain navigate("/post/:id") from a share link, a
   * chrome notification or a card deep link used to render nothing.
   */
  const params = useParams()
  const postId = useMemo(
    () => (location.state?.postId as string) ?? params.postId,
    [location.state, params.postId],
  )
  const to = useMemo(() => location.state?.to as string, [location.state])

  const { data: upvotedPosts } = useUpvotedStatus([postId])

  // Use the hook to fetch the website post
  const { data: post, isLoading, isError, error } = useWebsitePost(postId)

  const userId = useMemo(() => post?.user?.id, [post?.user?.id])
  const { data: userStreaks } = useUserStreaksByIds(userId ? [userId] : [], !!userId)
  const { data: userOrganizations, getOrganizationsForUser } = useBulkUserOrganizations(userId ? [userId] : [])
  // Get setParams from the route store to update params on back button press
  const setParams = useRouteStore((state) => state.setParams)
  const queryClient = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)

  const { environment } = useEnvironmentStore()

  const userStreak = useMemo(() => {
    if (!userStreaks || !Array.isArray(userStreaks) || !userId) return 0
    const streak = userStreaks.find((s) => s.user_id === userId)
    return streak?.current_streak || 0
  }, [userStreaks, userId])

  // Back button handler: clears the postId param so the overlay will hide
  const handleBack = () => {
    // Invalidate the upvoted status query to ensure we have the latest data
    queryClient.invalidateQueries({ queryKey: ["upvoted-status"] })

    if (location.state?.from === "notifications") {
      navigate("/notifications")
    } else if (location.state?.from) {
      navigate(".", {
        state: {
          postId: null as any,
          from: null as any,
          to: null,
        }
      })
    } else navigate(".", { state: { postId: null as any, to: null } })
  }



  if(!postId || to !== "PostDetailView") {
    return null
  }

 /**
  
  if (isLoading) {
    return (
      <Box
        ref={containerRef}
        sx={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: environment === "popup" ? 540 : "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    )
  }
  
   
  */

  if (isError) {
    return (
      <Box ref={containerRef} sx={{ p: 2, position: "relative" }}>
        <TooltipWrapper
          title="Go back"
          componentsProps={{
            tooltip: { sx: { fontSize: "10px", padding: "2px 4px" } },
          }}
        >
          <IconButton
            onClick={handleBack}
            sx={{
              color: "white",
              width: "16px",
              height: "16px",
              minWidth: "16px",
              backgroundColor: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "8px",
              m: "10px",
              minHeight: "16px",
              padding: "10px",
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 12 }} />
          </IconButton>
        </TooltipWrapper>
        {/* Not `Error: {error.message}`. That printed the server's own
            exception class at readers — see helpers/apiError. */}
        <Typography color="error">
          {humanApiError(error, "Couldn't load this post. Try again in a moment.")}
        </Typography>
      </Box>
    )
  }

  if(isLoading) {
    return <Box ref={containerRef} sx={{ p: 2, position: "relative", display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }} >
      <CircularProgress />
    </Box>
  }

  if (!post ) {
    return (
      <Box ref={containerRef} sx={{ p: 2, position: "relative" }} >
        <TooltipWrapper
          title="Go back"
          componentsProps={{
            tooltip: { sx: { fontSize: "10px", padding: "2px 4px" } },
          }}
        >
          <IconButton
            onClick={handleBack}
            sx={{
              color: "white",
              width: "16px",
              height: "16px",
              minWidth: "16px",
              backgroundColor: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "8px",
              m: "10px",
              minHeight: "16px",
              padding: "10px",
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 12 }} />
          </IconButton>
        </TooltipWrapper>
        <Typography>Post not found.</Typography>
      </Box>
    )
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        p: 0,
        width: "100%",
        overflowY: "auto",
        height: environment === "popup" ? 540 : "100vh",
      }}
    >
      <TooltipWrapper
        title="Go back"
        componentsProps={{
          tooltip: { sx: { fontSize: "10px", padding: "2px 4px" } },
        }}
      >
        <IconButton
          onClick={handleBack}
          sx={{
            color: "white",
            width: "16px",
            height: "16px",
            minWidth: "16px",
            backgroundColor: "#232323",
            m: "10px",
            minHeight: "16px",
            padding: "10px",
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </TooltipWrapper>
      <Box sx={{
        p: "10px"
      }}>
      <Post
        {...post}
        isOwnProfile={false}
        isFromDetailView={true}
        isUpvoted={Array.isArray(upvotedPosts) ? upvotedPosts.includes(postId) : false}
        userStreak={userStreak}
        userOrganizations={getOrganizationsForUser(userId || "")}
        transaction={(post as any).post_transaction}
      />
      </Box>
    </Box>
  )
}
