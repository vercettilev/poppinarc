import { extensionAlive } from "~/helpers/extensionContext"

// Idempotent — `addCustomFonts()` is called from every ProvidersWrapper
// instance, and the content script mounts THREE of them (App, AnimatedMessages,
// CommunityNoteWrapper). Without this guard the host page's <head> ends up
// with 3× duplicate <style> tags injecting 6× @font-face declarations each,
// every page load. The browser then re-parses them and re-evaluates font
// loading rules per duplicate. A `data-poppin-fonts` marker on the first
// injection short-circuits the rest.
export const addCustomFonts = (element?: HTMLElement) => {
  /**
   * NO EXTENSION, NO FONTS. Every url() below is a chrome.runtime.getURL, and
   * on a page that has outlived its extension that call throws where it
   * stands — inside a React mount, which is how a dead page turned a missing
   * typeface into an uncaught error in the extension's Errors panel. X keeps
   * mounting new cells on an orphaned page, so it throws again on each one.
   *
   * Leaving is the whole fix: every family here is declared with a real
   * fallback stack at the point of use, so a page with no @font-face block
   * renders in the fallback instead of not rendering.
   */
  if (!extensionAlive()) return
  const target = element ?? document.head
  if (target && (target as HTMLElement | Document).querySelector) {
    if ((target as HTMLElement | Document).querySelector('style[data-poppin-fonts]')) {
      return
    }
  }
  const style = document.createElement("style")
  style.setAttribute("data-poppin-fonts", "")
  style.type = "text/css"
   style.appendChild(
    document.createTextNode(`
              @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Thin.ttf"
          )}') format('opentype');
          font-weight: 100;
          font-style: normal;
        }
  
  
        @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Light.ttf"
          )}') format('opentype');
          font-weight: 300;
          font-style: normal;
        }
        @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Regular.ttf"
          )}') format('opentype');
          font-weight: 400;
          font-style: normal;
        }
        @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Medium.ttf"
          )}') format('opentype');
          font-weight: 500;
          font-style: normal;
        }
                @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Bold.ttf"
          )}') format('opentype');
          font-weight: 700;
          font-style: normal;
        }
  
        @font-face {
          font-family: 'PoppinSans';
          src: url('${chrome.runtime.getURL(
            "/fonts/Poppins-Bold.ttf"
          )}') format('opentype');
          font-weight: 600;
          font-style: normal;
        }
  
      `)
  )
  
  target.appendChild(style)
}
