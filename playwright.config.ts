import { defineConfig } from "@playwright/test"

const port = 8090
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://makeit:makeit@127.0.0.1:5433/makeit_e2e"

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  // Reduced motion: the three.js backdrop renders a single frame instead of animating on software WebGL.
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure", reducedMotion: "reduce" },
  // The skeleton spec covers first-run setup, so it must run before anything creates the admin.
  projects: [
    { name: "first-run", testMatch: /skeleton\.spec\.ts/ },
    { name: "app", testIgnore: /skeleton\.spec\.ts/, dependencies: ["first-run"] },
  ],
  webServer: {
    command: "pnpm build && node e2e/reset-db.ts && node src/server/index.ts",
    url: `http://localhost:${port}/healthz`,
    env: { PORT: String(port), DATABASE_URL: databaseUrl },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
