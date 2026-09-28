import { CssBaseline } from "@mui/material"
import { ReactNode, useEffect } from "react"
import { disableIOSTextFieldZoom } from "~/helpers/disableIOSTextFieldZoom"
import { addCustomFonts } from "~/helpers/fontHelper"
import { InvalidateQueryProvider } from "./providers/InvalidateQueryProvider"
import RTKProvider from "./providers/RTKProvider"
import StyleProvider from "./providers/StyleProvider"
import { ToastProvider } from "./Toast/ToastProvider"
const ProvidersWrapper = ({ children }: { children: ReactNode }) => {
  useEffect(() => {
    addCustomFonts()

    disableIOSTextFieldZoom()

    if (typeof window === "undefined") return

    const isPoppinWidgetExists = window.document.body.querySelector(
      "#poppin-iframe"
    )

    // Check for the comment <!--poppin-widget-*-->
    const hasPoppinWidgetComment =
      window.document.body.innerHTML.includes("<!--poppin-widget-")

    if (isPoppinWidgetExists || hasPoppinWidgetComment) {
      return
    }
  }, [])
  return (
      <RTKProvider>
        <StyleProvider>
          
            <ToastProvider>
                <CssBaseline>
                  <InvalidateQueryProvider>


{children}

                  </InvalidateQueryProvider>
                </CssBaseline>
            </ToastProvider>
          
        </StyleProvider>
      </RTKProvider>
  )
}

export default ProvidersWrapper
