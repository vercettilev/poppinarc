import { motion } from "framer-motion"
import { useCallback, useEffect, useState } from "react"

interface SparkleProps {
  color: string
  size: number
  style: React.CSSProperties
}

const Sparkle = ({ color, size, style }: SparkleProps) => (
  <motion.div
    initial={{ scale: 0 }}
    animate={{
      scale: 1,
      opacity: [1, 0],
    }}
    transition={{
      duration: 0.8,
      ease: "easeOut",
    }}
    style={{
      position: "absolute",
      width: size,
      height: size,
      background: color,
      borderRadius: "50%",
      ...style,
    }}
  />
)

interface SparkleContainerProps {
  isAnimating: boolean
}

export const SparkleContainer = ({ isAnimating }: SparkleContainerProps) => {
  const [sparkles, setSparkles] = useState<
    Array<{ id: number; props: SparkleProps }>
  >([])

  const generateSparkles = useCallback(() => {
    const colors = ["#FF69B4", "#87CEEB", "#98FB98", "#DDA0DD", "#F0E68C"]
    const newSparkles = Array.from({ length: 100 }).map((_, index) => {
      const angle = Math.random() * Math.PI * 2
      const distance = 50 + Math.random() * 150
      const size = Math.random() * 4 + 2

      const x = Math.cos(angle) * distance + (Math.random() - 0.5) * 40
      const y = Math.sin(angle) * distance + (Math.random() - 0.5) * 40

      return {
        id: index,
        props: {
          color: colors[Math.floor(Math.random() * colors.length)],
          size,
          style: {
            transform: `translate(${x}px, ${y}px)`,
          },
        },
      }
    })
    setSparkles(newSparkles)
  }, [])

  useEffect(() => {
    if (isAnimating) {
      generateSparkles()
      const timeout = setTimeout(() => {
        setSparkles([])
      }, 1000)
      return () => clearTimeout(timeout)
    }
  }, [isAnimating, generateSparkles])

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      {sparkles.map(({ id, props }) => (
        <Sparkle key={id} {...props} />
      ))}
    </div>
  )
}
