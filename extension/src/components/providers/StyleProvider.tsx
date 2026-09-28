import createCache, { EmotionCache } from "@emotion/cache"
import { CacheProvider } from "@emotion/react"
import { Theme, ThemeProvider } from "@mui/material"
import React, { useEffect, useRef, useState } from "react"
import { createMyTheme } from "~/helpers/themeHelper"

export default function StyleProvider({ children }: { children: React.ReactElement }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [cache, setCache] = useState<EmotionCache | null>(null)
  const [theme, setTheme] = useState<Theme | null>()
  useEffect(() => {
    const currEl = ref.current
    if (!currEl) {
      return
    }

    const c = createCache({
      key: "poppin-cache-key",
      prepend: true,
      container: currEl,
    })

    const t = createMyTheme(currEl)

    setTheme(t)
    setCache(c)
    return () => {
      c.sheet.flush()
    }
  }, [])

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {cache &&
        theme && ( // this is ugly but better ways didn't work
          <CacheProvider value={cache}>
            <ThemeProvider theme={theme}>{children}</ThemeProvider>
          </CacheProvider>
        )}
    </div>
  )
}

/*

// this doesn't work

  if (!cache || !theme) {
    return null
  }

  return (
    <div ref={ref}>
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </CacheProvider>
    </div>
  )
    
*/
