import { Box } from "@mui/material"
import { ReactNode, useEffect, useRef } from "react"

interface CustomInfiniteScrollProps {
  onLoadMore: () => void | Promise<any>
  hasMore: boolean
  isLoading: boolean
  children: ReactNode
  loadingComponent?: ReactNode
  containerRef?: React.RefObject<HTMLElement | null>
  threshold?: number
  rootMargin?: string
  reverse?: boolean // For reverse scrolling like chat
}

export default function CustomInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  children,
  loadingComponent,
  containerRef,
  threshold = 0.1,
  // 600px, not 20: page N+1 should be CACHED before the reader arrives.
  // At 20px every committed scroller caught the wordless spinner - the
  // slot machine stopping to reload between pulls.
  rootMargin = '600px 0px',
  reverse = false
}: CustomInfiniteScrollProps) {
  const loadTriggerRef = useRef<HTMLDivElement>(null)

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadTriggerRef.current || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !isLoading) {
          onLoadMore()
        }
      },
      {
        root: containerRef?.current || null,
        rootMargin,
        threshold,
      }
    )

    observer.observe(loadTriggerRef.current)

    return () => {
      observer.disconnect()
    }
  }, [hasMore, isLoading, onLoadMore, containerRef, rootMargin, threshold])

  const defaultLoadingComponent = (
    <Box sx={{ textAlign: "center", p: 2 }}>
      Loading more...
    </Box>
  )

  if (reverse) {
    return (
      <>
        {isLoading && (loadingComponent || defaultLoadingComponent)}
        
        {children}
        
        {/* Invisible trigger div for infinite scroll */}
        {hasMore && (
          <div 
            ref={loadTriggerRef}
            id="load-trigger"
            style={{ 
              height: '1px', 
              width: '100%',
              visibility: "hidden"
            }}
          />
        )}
      </>
    )
  }

  return (
    <>
      {children}
      
      {/* Invisible trigger div for infinite scroll */}
      {hasMore && (
        <div 
          ref={loadTriggerRef}
          style={{ 
            height: '1px', 
            width: '100%',
            visibility: "hidden"
          }}
        />
      )}
      
      {isLoading && (loadingComponent || defaultLoadingComponent)}
    </>
  )
} 