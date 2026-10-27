import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BoardPage } from "./board.tsx"
import { AuthedLayout, LoginPage } from "./login.tsx"
import { ProjectsPage } from "./projects.tsx"
import "./styles.css"

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } })

const root = createRootRoute({ component: Outlet })
const login = createRoute({ getParentRoute: () => root, path: "/login", component: LoginPage })
const authed = createRoute({ getParentRoute: () => root, id: "authed", component: AuthedLayout })
const projects = createRoute({ getParentRoute: () => authed, path: "/", component: ProjectsPage })
export const boardRoute = createRoute({ getParentRoute: () => authed, path: "$key", component: BoardPage })

const router = createRouter({
  routeTree: root.addChildren([login, authed.addChildren([projects, boardRoute])]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
