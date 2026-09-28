import React, { CSSProperties, ReactNode, RefObject, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"

interface TooltipStyles {
  fontSize?: string
  padding?: string
  maxWidth?: string
  backgroundColor?: string
  color?: string
  border?: string
  borderRadius?: string
  boxShadow?: string
  zIndex?: number
}

interface CustomTooltipProps {
  title: string
  children: ReactNode
  placement?: "top" | "bottom" | "left" | "right" | "bottom-start" | "top-start"
  delay?: number
  parentRef?: RefObject<HTMLElement | null>
  componentsProps?: {
    tooltip?: {
      sx?: TooltipStyles
    }
  }
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({
  title,
  children,
  placement = "bottom",
  delay = 500,
  parentRef,
  componentsProps,
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout>(null)

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    
    // If we have a parent ref, calculate position relative to parent
    const parentRect = parentRef?.current?.getBoundingClientRect()
    const baseTop = parentRect ? parentRect.top : 0
    const baseLeft = parentRef?.current?.scrollLeft || 0

    let top = 0
    let left = 0

    if (parentRef?.current) {
      // Position relative to parent container
      const parentHeight = parentRef.current.clientHeight
      const parentWidth = parentRef.current.clientWidth
      
      switch (placement) {
        case "bottom":
          // Position 10px from bottom of parent
          top = parentHeight - tooltipRect.height - 10
          left = (triggerRect.left - (parentRect?.left || 0)) + (triggerRect.width - tooltipRect.width) / 2
          break
        case "top":
          top = (triggerRect.top - baseTop) - tooltipRect.height - 8
          left = (triggerRect.left - (parentRect?.left || 0)) + (triggerRect.width - tooltipRect.width) / 2
          break
        case "bottom-start":
          top = parentHeight - tooltipRect.height - 10
          left = (triggerRect.left - (parentRect?.left || 0))
          break
        case "top-start":
          top = (triggerRect.top - baseTop) - tooltipRect.height - 8
          left = (triggerRect.left - (parentRect?.left || 0))
          break
        case "left":
          top = (triggerRect.top - baseTop) + (triggerRect.height - tooltipRect.height) / 2
          left = (triggerRect.left - (parentRect?.left || 0)) - tooltipRect.width - 8
          break
        case "right":
          top = (triggerRect.top - baseTop) + (triggerRect.height - tooltipRect.height) / 2
          left = (triggerRect.right - (parentRect?.left || 0)) + 8
          break
        default:
          break
      }

      // Ensure tooltip stays within parent bounds
      if (left < 0) left = 8
      if (left + tooltipRect.width > parentWidth) left = parentWidth - tooltipRect.width - 8
      if (top < 0) top = 8
      if (top + tooltipRect.height > parentHeight) {
        top = parentHeight - tooltipRect.height - 8
      }
    } else {
      // Original positioning logic for document body
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft

      switch (placement) {
        case "top":
          top = triggerRect.top + scrollTop - tooltipRect.height - 8
          left = triggerRect.left + scrollLeft + (triggerRect.width - tooltipRect.width) / 2
          break
        case "bottom":
          top = triggerRect.bottom + scrollTop + 8
          left = triggerRect.left + scrollLeft + (triggerRect.width - tooltipRect.width) / 2
          break
        case "left":
          top = triggerRect.top + scrollTop + (triggerRect.height - tooltipRect.height) / 2
          left = triggerRect.left + scrollLeft - tooltipRect.width - 8
          break
        case "right":
          top = triggerRect.top + scrollTop + (triggerRect.height - tooltipRect.height) / 2
          left = triggerRect.right + scrollLeft + 8
          break
        case "bottom-start":
          top = triggerRect.bottom + scrollTop + 8
          left = triggerRect.left + scrollLeft
          break
        case "top-start":
          top = triggerRect.top + scrollTop - tooltipRect.height - 8
          left = triggerRect.left + scrollLeft
          break
        default:
          break
      }

      // Ensure tooltip stays within viewport
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      if (left < 0) left = 8
      if (left + tooltipRect.width > viewportWidth) left = viewportWidth - tooltipRect.width - 8
      if (top < 0) top = 8
      if (top + tooltipRect.height > viewportHeight + scrollTop) {
        top = viewportHeight + scrollTop - tooltipRect.height - 8
      }
    }

    setPosition({ top, left })
  }, [placement, parentRef])

  const showTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
      // Calculate position after tooltip becomes visible
      setTimeout(() => calculatePosition(), 10)
    }, delay)
  }, [delay, calculatePosition])

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(false)
  }, [])

  const defaultTooltipStyles: CSSProperties = {
    position: parentRef?.current ? "absolute" : "absolute",
    backgroundColor: "#333",
    color: "white",
    padding: "8px",
    borderRadius: "4px",
    fontSize: "12px",
    zIndex: 1000,
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
    pointerEvents: "none",
    opacity: isVisible ? 1 : 0,
    visibility: isVisible ? "visible" : "hidden",
    transition: "opacity 0.2s ease, visibility 0.2s ease",
    maxWidth: "200px",
    whiteSpace: "normal" as const,
    wordWrap: "break-word" as const,
    ...componentsProps?.tooltip?.sx,
  }

  const tooltipElement = isVisible ? (
    <div
      ref={tooltipRef}
      style={{
        ...defaultTooltipStyles,
        top: position.top,
        left: position.left,
      }}
    >
      {title}
    </div>
  ) : null

  return (
    <>
      <div
        ref={triggerRef}
        style={{ display: "inline-block" }}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </div>
      {parentRef?.current ? 
        createPortal(tooltipElement, parentRef.current) : 
        tooltipElement
      }
    </>
  )
}

export default CustomTooltip 