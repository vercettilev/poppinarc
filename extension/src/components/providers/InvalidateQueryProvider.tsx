import { useQueryClient } from "@tanstack/react-query"
import { ReactNode, useEffect } from "react"
import "~/enableDevHmr"

export const InvalidateQueryProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!queryClient) {
      return
    }
    /**
     try {
      const listener = (message: {
        action: string
        payload: {
          names: string[]
        }
      }) => {
        if (message.action === "INVALIDATE_QUERY") {
          message?.payload?.names.forEach((name: string) => {
            queryClient.invalidateQueries({
              queryKey: [name],
            })
          })
        }
      }

      chrome.runtime.onMessage.addListener(listener)

      return () => {
        chrome.runtime.onMessage.removeListener(listener)
      }
    } catch (error) {
      console.error("Failed to invalidate query", error)
    } 
  
  
 */
  }, [queryClient])

  return <>{children}</>
}
