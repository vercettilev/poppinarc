import { useEffect, useState } from "react"

/**
 * Hook to calculate the sum of heights of specified fixed elements
 * @returns {number} The total height in pixels
 */
export const useElementsHeight = (): number => {
  const [totalHeight, setTotalHeight] = useState<number>(0)

  useEffect(() => {
    const calculateHeight = () => {
      try {
        const header = document.getElementById("header")
        const chatMenu = document.getElementById("chat-menu")
        const actionBar = document.getElementById("action-bar")

        const headerHeight = header?.offsetHeight || 0
        const chatMenuHeight = chatMenu?.offsetHeight || 0
        const actionBarHeight = actionBar?.offsetHeight || 0

        const sum = headerHeight + chatMenuHeight + actionBarHeight

        // Validate the sum is reasonable (not too large or negative)
        if (sum >= 0 && sum < window.innerHeight) {
          setTotalHeight(sum)
        } else {
          // Fallback to a reasonable default if calculation seems wrong
          setTotalHeight(120) // Approximate default sum
        }
      } catch (error) {
        console.error("Error calculating elements height", error)
        setTotalHeight(120) // Fallback to default on error
      }
    }

    // Initial calculation
    calculateHeight()

    // Recalculate on window resize
    window.addEventListener("resize", calculateHeight)

    // Cleanup
    return () => {
      window.removeEventListener("resize", calculateHeight)
    }
  }, []) // Empty dependency array since we only need to set this up once

  return totalHeight
}
