import { JUICE } from "~/theme/juice"
import { BRAND_GROUND } from "~/helpers/brandGround"
import {
  alpha,
  Box,
  Button,
  Checkbox,
  Paper,
  Skeleton,
  styled,
  TextField,
  Typography,
  useTheme,
} from "@mui/material"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate, useNavigationType } from "react-router"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useReportWebsitePost, useWebsitePosts } from "~/hooks/useWebsitePosts"
import { ReportType } from "~/services/WebsitePostService"
import { useActionMenuDialogStore } from "~/store/useActionMenuDialogStore"
import {
  useAppConfigStore,
  useEnvironmentStore,
} from "~/store/useAppConfigStore"
import { useSortStore } from "~/store/useSortStore"
import { useUIStore } from "~/store/useUIStore"
import ActionBar from "./ActionBar"
import { CDialog } from "./Dialog/CDialog"
import { DialogButton } from "./Dialog/DialogButton"
import { Header } from "./Header"
import SignInRedirect from "./SignInRedirect"
import { PermissionBanner } from "~/components/PermissionBanner"
import { useToast } from "./Toast/ToastProvider"
const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "hate", label: "Hate Speech" },
  { value: "violence", label: "Violence" },
  { value: "misleading", label: "Misleading Information" },
  { value: "self_harm", label: "Self Harm" },
  { value: "child_exploitation", label: "Child Exploitation" },
  { value: "impersonation", label: "Impersonation" },
  { value: "privacy_violation", label: "Privacy Violation" },
  { value: "other", label: "Other" },
]

import { useViewStore } from "~/store/useViewStore"

const StyledPaper = styled(Paper)(
  ({
    theme,
    environment,
  }: {
    theme: any
    environment: string
  }) => ({
    minHeight: "100svh",
    height: "100svh",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    position: "relative",
    // The canvas — single source of truth for the page surface. Every
    // screen renders on top of this; no view should set its own page-bg
    // color (use alpha tints instead).
    //
    // poppin.so's ground is a blue-cast near-black with two ambient accent
    // auroras — the lighting that makes cards read as objects in a dark room
    // rather than outlines on a void.
    // The CARD's ground, verbatim, via the one shared source — see
    // helpers/brandGround.ts. This used to be a paler two-aurora variant on
    // opposite corners with no blue-cast sweep, and side by side the card
    // sat in a lit room while the panel sat in front of a black wall.
    ...BRAND_GROUND,
    width: "100%",
    overflow: "hidden",
    // THE PANEL IS THE WINDOW; THE WIDGET IS A CARD ON SOMEONE ELSE'S PAGE.
    //
    // The hairline and the 18px radius both exist for the injected in-page
    // widget, which floats over a host site and has to read as a detached
    // object. In the Chrome side panel they were the defect: this Paper IS
    // the viewport (100svh × 100%), so a radius here bites four notches out
    // of the ground and lets the panel document's own canvas show through
    // beside it — reported as "the background doesn't reach the edges, a
    // different colour shows around the frame".
    //
    // The border was already gated for the panel and the radius was not,
    // which is how one rule stayed correct while its twin shipped the bug.
    // They are one decision, so they are stated in one place now.
    //
    // THIS GATE ALONE CHANGES NOTHING THE READER CAN SEE. This shell is not
    // the outermost box: entries/popup/App.tsx wraps it in a second Paper
    // (className "popup-app") that hides its overflow, and a parent that
    // hides its overflow clips every descendant to ITS corner. Squaring only
    // this one left all four notches exactly where they were. The same gate,
    // in the same words, lives there too — components/panel-frame.spec.ts
    // asserts both, together, for that reason.
    //
    // ZERO, NOT ABSENT: deleting `borderRadius` would hand the corner back to
    // the theme's MuiPaper default (16px, helpers/themeHelper.ts) — the same
    // defect, 2px smaller and harder to see.
    ...(environment === "sidepanel"
      ? { border: "none", borderRadius: 0 }
      : {
          border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
          borderRadius: "18px",
        }),
    "& > *": {
      position: "relative",
      zIndex: 1,
    },

  })
)

export default function Layout() {
  const { showToast } = useToast()
  const location = useLocation()
  /**
   * THE SCREEN ANNOUNCES WHICH WAY IT CAME.
   *
   * Restarted imperatively rather than keyed on the pathname: a key would
   * remount the screen inside this box and re-run every fetch it owns, which
   * is a real cost paid for a decoration. Removing the class, reading a
   * layout property to commit that, then adding it back is what replays a
   * CSS animation on an element that never left the tree.
   *
   * POP is the back button and everything else is going deeper, so the two
   * directions are the router's own answer rather than a guess. The
   * reduced-motion blanket in App.css flattens both to nothing.
   */
  const viewRef = useRef<HTMLDivElement | null>(null)
  const navType = useNavigationType()
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const cls = navType === "POP" ? "panel-view-back" : "panel-view-in"
    el.classList.remove("panel-view-in", "panel-view-back")
    void el.getBoundingClientRect().width
    el.classList.add(cls)
  }, [location.pathname, navType])
  const { setCurrentPath } = useAppConfigStore()
  // Store current path whenever it changes

  const navigate = useNavigate()

  useEffect(() => {
    chrome.storage.local.get("initialRoute").then((result: any) => {
      const initialRoute = result.initialRoute
      if (initialRoute) {
        navigate(initialRoute)
        chrome.storage.local.remove("initialRoute")
      } else navigate(currentPath)
    })

    // Listen for route changes while side panel is already open
    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.initialRoute?.newValue) {
        navigate(changes.initialRoute.newValue)
        chrome.storage.local.remove("initialRoute")
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [])

  // Delete reason state for admin deletions
  const [deleteReason, setDeleteReason] = useState("")


  useEffect(() => {
    setCurrentPath(location.pathname)
  }, [location.pathname, setCurrentPath])

  // Check if extension is pinned and complete the task if true
  /**
   * THE PIN WATCHER IS GONE WITH THE TASK IT FED. It asked the background
   * whether the extension was pinned, on mount and on every pin change, to
   * mark a task on a screen nobody can reach. Pinning is still worth
   * encouraging — the onboarding does it — but not by writing a row into a
   * retired ledger (panel audit, 2026-09-20).
   */

  const { currentPath } = useAppConfigStore()

  const theme = useTheme()

  const { environment } = useEnvironmentStore()
  const { sort } = useSortStore()
  const { view, setView } = useViewStore()
  const { setIsSignInModalOpen } = useUIStore()

  // Check if current route is notifications
  const isRenderActionBar = useMemo(
    () =>
      !(
        [
          "/profile",
          "/settings",
          "/wallet-ui",
          "/create-profile",
          "/wallet",
          "/receive",
        ].includes(location.pathname) &&
        !(location.state?.userId || location.state?.postId)
      ),
    [location.pathname, location.state]
  )

  const { data: currentUser } = useCurrentUser()

  // Action menu dialog store
  const {
    dialogMode: actionDialogMode,
    selectedReportType,
    currentPostId,
    currentUserId,
    authorId,
    contentType,
    onDeleteCallback,
    externalLinkUrl,
    setSelectedReportType,
    closeDialog: closeActionDialog,
  } = useActionMenuDialogStore()
  const { mutate: reportPost } = useReportWebsitePost()

  // Action menu dialog handlers
  const handleActionDialogClose = useCallback(() => {
    setDeleteReason("")
    closeActionDialog()
  }, [closeActionDialog])

  const handleExternalLinkConfirm = useCallback(() => {
    // Send message to background script to open link in new tab
    chrome.runtime.sendMessage({
      type: "openTab",
      payload: { url: externalLinkUrl },
    })
    closeActionDialog()
  }, [externalLinkUrl, closeActionDialog])

  // Fetch most liked posts for the website when external link dialog is open.
  //
  // The `enabled` gate is what makes that sentence true. Without it this
  // query ran on every mount of the layout — that is, on every panel open —
  // with `website_url: ""`, because useActionMenuDialogStore seeds
  // externalLinkUrl to "" and resets it to "" on close. One wasted round trip
  // per open, and a comment describing a condition the code did not have.
  const { data: websitePostsData, isLoading: isLoadingWebsitePosts } =
    useWebsitePosts({
      enabled: actionDialogMode === "externalLink" && !!externalLinkUrl,
      isDomainPost: true,
      limit: 3,
      website_url: externalLinkUrl,
      range: "all",
      sort: {
        field: "upvotes",
        order: "DESC",
      },
    })

  const topWebsitePosts = useMemo(() => {
    if (!websitePostsData?.pages) return []
    return websitePostsData.pages.flatMap((page) => (page as any).data || []).slice(0, 3)
  }, [websitePostsData])

  const handleReportTypeSelect = useCallback(
    (type: ReportType) => {
      setSelectedReportType(type)
    },
    [setSelectedReportType]
  )

  const handleDeleteConfirm = useCallback(() => {
    // Check if admin is deleting someone else's post
    const isAdmin = currentUser?.role === "admin"
    const isOwner = currentUserId === authorId
    const needsReason = isAdmin && !isOwner

    if (needsReason && !deleteReason.trim()) {
      // Don't allow delete without reason
      return
    }

    if (onDeleteCallback) {
      // Pass reason to callback if it's an admin deletion
      onDeleteCallback(needsReason ? deleteReason : undefined)
    }
    setDeleteReason("")
    closeActionDialog()
  }, [
    onDeleteCallback,
    closeActionDialog,
    currentUser,
    currentUserId,
    authorId,
    deleteReason,
  ])

  const contentTypeCapitalized =
    contentType.charAt(0).toUpperCase() + contentType.slice(1)
  const handleReportSubmit = useCallback(() => {
    if (!currentUser || (currentUser && !currentUser.username)) {
      setIsSignInModalOpen(true)
      return
    }
    const contentTypeCapitalized =
      contentType.charAt(0).toUpperCase() + contentType.slice(1)

    reportPost(
      { postId: currentPostId, type: selectedReportType, contentType },
      {
        onSuccess: (res: any) => {
          closeActionDialog()

          if ("success" in res && !res.success) {
            console.error("Failed to report", res.error)
            showToast(
              `Failed to report ${contentType}. Please try again.`,
              "error"
            )
          } else {
            showToast(
              `${contentTypeCapitalized} reported successfully`,
              "success"
            )
          }
        },
        onError: (error) => {
          console.error("Failed to report", error)
          showToast(
            `Failed to report ${contentType}. Please try again.`,
            "error"
          )
        },
      }
    )
  }, [
    currentUser,
    currentPostId,
    selectedReportType,
    contentType,
    reportPost,
    showToast,
    closeActionDialog,
  ])

  return (
    <StyledPaper
      elevation={0}
      className="popup-app"
      theme={theme}
      environment={environment}
    >
      {/*
        An empty <style dangerouslySetInnerHTML> stood here — a `__html` of
        nothing but blank lines, injected into the document on every route
        because this layout wraps every route. Nothing in src queried for it.
        Deleted rather than left as a placeholder: this repo does not ship
        elements that render empty.
      */}

      {/* Action Menu Delete Dialog */}
      <CDialog
        open={actionDialogMode === "delete"}
        onClose={handleActionDialogClose}
        title={`Delete ${contentTypeCapitalized}`}
        minWidth="300px"
        onClick={(e) => e.stopPropagation()}
        actions={
          <>
            <DialogButton onClick={handleActionDialogClose}>
              Cancel
            </DialogButton>
            <DialogButton
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={
                currentUser?.role === "admin" &&
                currentUserId !== authorId &&
                !deleteReason.trim()
              }
            >
              Delete
            </DialogButton>
          </>
        }
      >
        <Typography
          sx={{
            color: "#FFFFFF",
            mb:
              currentUser?.role === "admin" && currentUserId !== authorId
                ? 2
                : 0,
          }}
        >
          Are you sure you want to delete this {contentType}?
        </Typography>
        {currentUser?.role === "admin" && currentUserId !== authorId && (
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Reason for deletion (required)"
            placeholder="Enter the reason for deleting this post..."
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            required
            sx={{
              "& .MuiInputBase-root": {
                backgroundColor: "rgba(122,183,255,.10)",
                color: "#FFFFFF",
                borderRadius: "8px",
              },
              "& .MuiInputBase-input": {
                color: "#FFFFFF",
              },
              "& .MuiInputLabel-root": {
                color: JUICE.text2,
              },
              "& .MuiInputLabel-root.Mui-focused": {
                color: "#FFFFFF",
              },
              "& .MuiOutlinedInput-root": {
                "& fieldset": {
                  borderColor: "rgba(255, 255, 255, 0.3)",
                },
                "&:hover fieldset": {
                  borderColor: JUICE.text2,
                },
                "&.Mui-focused fieldset": {
                  borderColor: "#FFFFFF",
                },
              },
              "& .MuiInputBase-input::placeholder": {
                color: JUICE.text2,
                opacity: 1,
              },
            }}
          />
        )}
      </CDialog>

      {/* Action Menu Report Dialog */}
      <CDialog
        open={actionDialogMode === "report"}
        onClose={handleActionDialogClose}
        title={`Report ${contentTypeCapitalized}`}
        minWidth="300px"
        maxHeight="80vh"
        onClick={(e) => e.stopPropagation()}
        actions={
          <>
            <DialogButton onClick={handleActionDialogClose}>
              Cancel
            </DialogButton>
            <DialogButton variant="primary" onClick={handleReportSubmit}>
              Report
            </DialogButton>
          </>
        }
      >
        <Typography sx={{ mb: 1, color: "#FFFFFF" }}>
          Why are you reporting this {contentType}?
        </Typography>
        <div style={{ overflowY: "auto", maxHeight: "50vh" }}>
          {REPORT_TYPES.map((type) => (
            <div
              key={type.value}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "2px 0",
              }}
              onClick={() => handleReportTypeSelect(type.value)}
            >
              <Checkbox
                checked={selectedReportType === type.value}
                size="small"
                sx={{
                  padding: "2px",
                  "& .MuiSvgIcon-root": { fontSize: 18 },
                  color: "#FFFFFF",
                  "&.Mui-checked": {
                    color: "#FFFFFF",
                  },
                }}
              />
              <Typography
                variant="body2"
                sx={{
                  fontSize: "12px",
                  cursor: "pointer",
                  color: "#FFFFFF",
                }}
              >
                {type.label}
              </Typography>
            </div>
          ))}
        </div>
      </CDialog>

      {/* External Link Warning Dialog */}
      <CDialog
        transitionDuration={0}
        hideBackdrop={true}
        open={actionDialogMode === "externalLink"}
        onClose={handleActionDialogClose}
        title="External Link on Poppin"
        maxWidth="100vw"
        minWidth="100vw"
        maxHeight="100vh"
        showBorder={false}
        onClick={(e) => e.stopPropagation()}
        slotProps={{
          paper: {
            sx: {
              margin: 0,
              height: "100vh",
              maxHeight: "100vh",
              borderRadius: "18px",
              backgroundColor: theme.palette.tetriary.main,
              background: theme.palette.tetriary.main,
            },
          },
        }}
      >
        <Typography sx={{ mb: 2, color: "#FFFFFF" }}>
          You are about to open a external link shared on Poppin. Please check
          if the website is safe before visiting:
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: "12px",
            color: theme.palette.primary.main,
            wordBreak: "break-all",
            backgroundColor: "rgba(122,183,255,.10)",
            padding: "8px",
            borderRadius: "4px",
            fontFamily: "monospace",
            mb: 2,
          }}
        >
          {externalLinkUrl}
        </Typography>

        <Typography sx={{ mb: 2, fontSize: "12px", opacity: 0.8 }}>
          Are you sure you want to continue?
        </Typography>

        {/* Buttons moved here - above the posts */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "16px",
            width: "100%",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <DialogButton
            onClick={handleActionDialogClose}
            sx={{ flex: 0, py: 0.5, height: "28px", fontSize: 12 }}
          >
            Cancel
          </DialogButton>
          <DialogButton
            variant="primary"
            onClick={handleExternalLinkConfirm}
            sx={{ flex: 0, py: 0.5, height: "28px", fontSize: 12 }}
          >
            Continue
          </DialogButton>
        </div>

        {/* Show top posts from this website */}
        {topWebsitePosts.length > 0 && (
          <>
            <Typography
              sx={{ mb: 1, fontSize: "14px", fontWeight: "medium", color: "#FFFFFF" }}
            >
              Top posts from this website:
            </Typography>

            <div style={{ maxHeight: "200px", overflowY: "auto" }}>
              {topWebsitePosts.map((post) => (
                <div
                  key={post.id}
                  style={{
                    padding: "8px",
                    marginBottom: "8px",
                    backgroundColor: theme.palette.secondary.main,
                    borderRadius: "4px",
                    border: `1px solid ${alpha(theme.palette.secondary.main, 0.2)}`,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: "11px",
                      color: "#FFFFFF",
                      mb: 0.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {post.content}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontSize: "10px",
                      color: JUICE.text2,
                    }}
                  >
                    {post.upvotes} upvotes • {post.comment_count} comments
                  </Typography>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Show skeleton loaders while posts are loading */}
        {isLoadingWebsitePosts && (
          <>
            <Typography
              sx={{ mb: 1, fontSize: "14px", fontWeight: "medium", color: "#FFFFFF" }}
            >
              Top posts from this website:
            </Typography>
            <div style={{ maxHeight: "200px" }}>
              {[1, 2, 3].map((index) => (
                <div
                  key={index}
                  style={{
                    padding: "8px",
                    marginBottom: "8px",
                    backgroundColor: JUICE.well,
                    borderRadius: "4px",
                    border: `1px solid ${JUICE.border}`,
                  }}
                >
                  <Skeleton
                    variant="text"
                    width="100%"
                    height={32}
                    sx={{
                      backgroundColor: "rgba(122,183,255,.10)",
                      "&::after": {
                        background:
                          "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent)",
                      },
                    }}
                  />
                  <Skeleton
                    variant="text"
                    width="60%"
                    height={16}
                    sx={{
                      backgroundColor: "rgba(122,183,255,.10)",
                      "&::after": {
                        background:
                          "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent)",
                      },
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </CDialog>

      {![
        "/create-profile",
        "/receive",
      ].includes(location.pathname) && <Header />}
      {isRenderActionBar && <ActionBar sortBy={sort} />}
      {/*
        THE PANEL'S SIGN-IN GATES GO WHERE EVERY OTHER SURFACE'S DO.
        The modal that used to mount here was the commenting era's pitch
        ("Sign in to start commenting and interacting with others") over a
        second, divergent email+OTP auth path — shown at the exact moment
        of trade intent. The ladder decision is already recorded in
        pagePosts.openSignIn: one full-page welcome flow, ?flow=signin.
        Nine call sites raise the store flag; this effect answers all of
        them, so none of them had to change.
      */}
      <SignInRedirect />
      <PermissionBanner />
      {/*
        THE SCREEN MOVES, THE CHROME DOES NOT. Only what changed is animated:
        the header, the nav and the banners above stay put across a
        navigation, which is what makes the movement read as "this screen
        arrived" rather than "the app redrew".
      */}
      <Box
        ref={viewRef}
        style={{ "--panel-nav-ms": `${JUICE.cinemaNavMs}ms` } as never}
        /* A real box, because display:contents generates none and an
           animation needs one. The shell is a column flex, so this takes
           the place the screen already had in it: grow into the remaining
           height, allow its own scroller, and lay out its children the same
           way the shell did. */
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <Outlet />
      </Box>
    </StyledPaper>
  )
}
