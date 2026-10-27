import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: { proxy: { "/api/": "http://localhost:8080", "/healthz": "http://localhost:8080" } },
})
