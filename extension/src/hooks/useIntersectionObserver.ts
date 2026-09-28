import { useEffect, useRef } from "react"

interface UseIntersectionObserverProps {
  onIntersect: () => void
  enabled?: boolean
}

export function useIntersectionObserver({
  onIntersect,
  enabled = true,
}: UseIntersectionObserverProps) {
  const observerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onIntersect()
          }
        })
      },
      { threshold: 0.5 }
    )

    if (observerRef.current) {
      observer.observe(observerRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [onIntersect, enabled])

  return observerRef
}
