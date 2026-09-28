import { Tooltip, TooltipProps } from "@mui/material"
import { useRef } from "react"

interface TooltipWrapperProps extends Omit<TooltipProps, 'componentsProps'> {
  componentsProps?: TooltipProps['componentsProps']
}

/**
 * A wrapper around Material-UI Tooltip that handles conditional rendering
 * and container configuration for proper positioning within its own container.
 * Creates its own ref internally and doesn't require a ref from parent.
 * 
 * @param children - The element that triggers the tooltip
 * @param componentsProps - Additional props for tooltip components (will be merged with container config)
 * @param rest - All other Tooltip props
 */
export default function TooltipWrapper({
  children,
  componentsProps,
  ...rest
}: TooltipWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} style={{ display: 'inline-block' }}>
      {containerRef.current ? (
        <Tooltip
          {...rest}
          componentsProps={{
            ...componentsProps,
            popper: {
              container: containerRef.current,
              ...componentsProps?.popper,
            },
          }}
        >
          {children}
        </Tooltip>
      ) : (
        children
      )}
    </div>
  )
} 