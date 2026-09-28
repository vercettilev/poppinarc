import ReactDOM from "react-dom/client"
import ProvidersWrapper from "~/components/ProvidersWrapper"
import { ensureBrandFont } from "~/helpers/brandFont"
import { useEnvironmentStore } from "~/store/useAppConfigStore"
import { useCurrentUrlStore } from "~/store/useCurrentUrlStore"
import { useLaunchAssetStore } from "~/store/useLaunchAssetStore"
import App from "../popup/App"


// alert("side panel")

import { SidepanelProvider } from "~/components/providers/SidepanelProvider"
import "~/enableDevHmr"
import { RouterWrapper } from "~/providers/RouterWrapper"

// The theme says PoppinSans; this is what makes that true on THIS surface.
ensureBrandFont()

useEnvironmentStore.getState().setEnvironment("sidepanel")

const url = new URL(window.location.href)
const urlParams = url.searchParams
const urlParam = urlParams.get("url") || ""

if (urlParam) {
  useCurrentUrlStore.getState().setCurrentUrl(urlParam)
}

/**
 * The asset this panel was opened FOR, when the opener already knew.
 *
 * PageAssetStrip normally asks the active tab "what is this page about?".
 * That is right for a CoinGecko page and wrong for X: measured live, the
 * panel matching x.com/home comes back with nothing, because the home feed
 * is not about one asset — the TWEET is. The chip that opened us already
 * resolved the mint on device, so it hands it over rather than making the
 * panel re-derive an answer the page cannot give.
 */
const mintParam = urlParams.get("mint") || ""
if (mintParam) {
  // `side` rides along when the opener knows what the reader already decided
  // — a tap on "ada bought $WIF" opens the Buy sheet rather than a card the
  // reader has to press Buy on again. Anything other than buy/sell is
  // ignored rather than trusted: this string arrives from a URL.
  const sideParam = urlParams.get("side")
  const side =
    sideParam === "buy" || sideParam === "sell" ? sideParam : undefined
  const usdParam = Number(urlParams.get("usd"))
  useLaunchAssetStore
    .getState()
    .setLaunchMint(mintParam, side, Number.isFinite(usdParam) && usdParam > 0 ? usdParam : undefined)
  // The path a notification set is consumed once: the toolbar icon reuses
  // the panel's path, and used to re-arm this Buy on every plain open.
  try {
    void chrome.sidePanel.setOptions({ path: "src/entries/side_panel/index.html" })
  } catch {
    // older Chrome without the API: the path stays, as before
  }
}

/**
 * THE PANEL COUNTS ITSELF, because nothing else can. The toolbar icon
 * opens this document through openPanelOnActionClick without touching any
 * message handler, so any count taken elsewhere misses the most ordinary
 * entrance. Module scope runs exactly once per open — no effect, no
 * StrictMode double.
 *
 * The source is read off the launch params this file already parses:
 * a notification stamps itself, a chip hands over a mint, a handoff hands
 * over a page, and a bare open is the toolbar — the one entrance that
 * leaves no trace, identified as the residue of the ones that do.
 */
try {
  const source = urlParams.get("src") === "notification"
    ? "notification"
    : mintParam
      ? "chip"
      : urlParam
        ? "handoff"
        : "toolbar"
  void chrome.runtime.sendMessage({
    type: "SPOT_TELEMETRY",
    event: "panel_opened",
    payload: { source },
  })
} catch {
  // Counting is never worth failing the panel over.
}

const appRoot = document.getElementById("app")!

ReactDOM.createRoot(appRoot).render(
  <RouterWrapper>
    <ProvidersWrapper>
      <SidepanelProvider>
        <App />
      </SidepanelProvider>
    </ProvidersWrapper>
  </RouterWrapper>
)
