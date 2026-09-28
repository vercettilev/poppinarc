import { useEffect } from "react"
import { useUIStore } from "~/store/useUIStore"

/**
 * The store flag every auth-gated control raises, answered by opening the
 * ONE sign-in flow the product has: the full-page welcome tab. See the
 * mount site in Layout for why the old modal is gone.
 */
export default function SignInRedirect() {
  const { isSignInModalOpen, setIsSignInModalOpen } = useUIStore()
  useEffect(() => {
    if (!isSignInModalOpen) return
    setIsSignInModalOpen(false)
    try {
      window.open(
        chrome.runtime.getURL("src/entries/welcome/index.html?flow=signin"),
        "_blank",
        "noopener",
      )
    } catch {
      // Orphaned context: the press did nothing, and a reload is the cure
      // every money surface already names.
    }
  }, [isSignInModalOpen, setIsSignInModalOpen])
  return null
}
