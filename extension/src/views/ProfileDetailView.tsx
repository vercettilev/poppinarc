import { Box } from "@mui/material"
import { useEffect, useMemo } from "react"
import { useLocation, useNavigate } from "react-router"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import Profile from "./profile"


export default function ProfileDetailView() {

    const location = useLocation()
    const navigate = useNavigate()
    const userId = useMemo(() => location.state?.userId as string, [location.state])
    const username = useMemo(() => location.state?.username as string, [location.state])
    const from = useMemo(() => location.state?.from as string, [location.state])
    const to = useMemo(() => location.state?.to as string, [location.state])
    const { data: currentUser } = useCurrentUser()

    /**
     * Is this overlay pointed at the reader themselves? It very often is:
     * PostHeader.tsx:105-111 (tapping an avatar) and UserPopover.tsx:80-86
     * (tapping a name) push this view with a bare `userId` and no self-check,
     * so tapping your own face on your own post lands here.
     *
     * The username branch matters for the doors that address a person by
     * handle; handles are compared case-insensitively because that is how
     * they are typed, and a mismatch here would only fall back to the old
     * behaviour rather than mis-fire.
     */
    const isSelf = Boolean(
        currentUser &&
            ((userId && userId === currentUser.id) ||
                (username &&
                    currentUser.username &&
                    username.toLowerCase() === currentUser.username.toLowerCase()))
    )

    /** The three gates this view has always had, hoisted so the hook below
     *  can run unconditionally — React does not allow an early return above
     *  a `useEffect`. */
    const isOpen = Boolean(userId || username) && Boolean(from) && to === "ProfileDetailView"

    /**
     * YOUR OWN PROFILE IS A DESTINATION, NOT A SHEET OVER THE FEED.
     *
     * ProfileHead draws no back arrow on your own page — it is your page, and
     * an arrow there reserved an empty 32px band to point nowhere with (see
     * components/profile/profileEntry). That rule is only honest if your own
     * profile never appears as this overlay, because this overlay hides the
     * feed behind it and the header's Feed pill paints itself ACTIVE while
     * the pathname is still `/feed` (Header.tsx:601) — an exit that does not
     * look like one. So a self-targeted overlay does not render: it hands the
     * reader to the `/profile` tab, which is the same page with the header's
     * identity row pointing at it and the Feed pill plainly inactive beside
     * it, one tap from the page feed (Header.tsx:717-724).
     *
     * `replace`, not a push: the entry being replaced is this overlay, which
     * the reader never actually saw. Pushing over it would leave a state in
     * history that re-opens the overlay and immediately bounces out of it
     * again.
     *
     * Somebody else's profile is untouched — that is a real pushed screen and
     * it keeps both the overlay and the arrow that closes it.
     */
    useEffect(() => {
        if (!isOpen || !isSelf) return
        navigate("/profile", { replace: true })
    }, [isOpen, isSelf, navigate])

    if (!isOpen) return null
    if (isSelf) return null

    // Chat and DMs were both retired; the feed is the only place back.
    const handleBack = () => {
        // "the feed is the only place back" — and the feed is `/feed`
        // now, so back actually goes there instead of to the portfolio.
        navigate("/feed", {
            state: {
                from: null as any,
                to: null,
                userId: null,
                username: null
            }
        })
    }


    return (
        <Box id="profile-detail-view">



      <Box>

            <Profile userId={userId || undefined} username={username || undefined} />
            </Box>
        </Box>
  )
}
