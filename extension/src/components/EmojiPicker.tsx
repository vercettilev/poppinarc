import { useTheme } from "@mui/material"
import { alpha } from "@mui/material/styles"
import { useEffect, useRef, useState } from "react"

const EmojiPicker = ({ onEmojiClick }: { onEmojiClick: (e: any) => void }) => {
  const theme = useTheme()
  const [importedComponent, setImportedComponent] = useState(null)
  const appRef = useRef(null)
  const isDark = true
  useEffect(() => {
    const importComponent = async () => {
      let retries = 3 // Number of retries
      while (retries > 0) {
        try {
          const module = await import("emoji-picker-react")
          const AnotherComponent = module.default

          setImportedComponent(
            // @ts-expect-error - TS doesn't know about AnotherComponent
            <AnotherComponent onEmojiClick={onEmojiClick} theme={"dark"} />
          )

          return // Exit the loop on success
        } catch (err) {
          retries-- // Decrement retries
          if (retries === 0) {
            throw err // Throw error if all retries are exhausted
          }
        }
      }
    }

    importComponent()
      .then(() => {
        const id = "flairup-epr"
        const existedStyle = document.getElementById(id)
        // clone it
        const clone = existedStyle?.cloneNode(true)
        // append it to appRef
        // @ts-expect-error - TS doesn't know about appendChild
        appRef?.current?.appendChild(clone)
      })
      .catch((err) => {})
  }, [onEmojiClick, isDark, appRef])

  return (
    <div ref={appRef}>
      <style>
        {`
          .epr-main {
            border-radius: 0px !important;
            background-color: ${theme.palette.secondary.main} !important;
          }
          .epr-emoji-category-label {
            border-radius: 0px !important;
            background-color: ${theme.palette.secondary.main} !important;
            color: ${alpha(theme.palette.secondary.contrastText, 0.5)} !important;
            font-size: 12px !important;
            font-weight: 400 !important;
            text-transform: uppercase !important;
          }
        `}
      </style>
      {importedComponent}
    </div>
  )
}

export default EmojiPicker
