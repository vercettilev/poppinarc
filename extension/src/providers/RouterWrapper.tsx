import { MemoryRouter } from "react-router"



export const RouterWrapper = ({children}: {children: React.ReactNode}) => {
  return (
    <MemoryRouter>
        {children}
    </MemoryRouter>
  )
}