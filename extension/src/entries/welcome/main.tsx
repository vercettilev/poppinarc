import ReactDOM from "react-dom/client"
import { ensureBrandFont } from "~/helpers/brandFont"
import ProvidersWrapper from "~/components/ProvidersWrapper"
import { RouterWrapper } from "~/providers/RouterWrapper"
import App from "./App"

// The theme says PoppinSans; this is what makes that true on THIS surface.
ensureBrandFont()

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <ProvidersWrapper>
    <RouterWrapper>

    <App />
    </RouterWrapper>
  </ProvidersWrapper>
)
