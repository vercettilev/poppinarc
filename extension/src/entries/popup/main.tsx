import ReactDOM from "react-dom/client"
import { ensureBrandFont } from "~/helpers/brandFont"
import { MemoryRouter } from "react-router"
import ProvidersWrapper from "~/components/ProvidersWrapper"
import "~/enableDevHmr"
import App from "./App"

// The theme says PoppinSans; this is what makes that true on THIS surface.
ensureBrandFont()

const appRoot = document.getElementById("app")!

ReactDOM.createRoot(appRoot).render(
  <MemoryRouter>
    <ProvidersWrapper>
      <App />
    </ProvidersWrapper>
  </MemoryRouter>
)
