import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: "src/server/test/global-setup.ts",
    setupFiles: "src/server/test/setup.ts",
    // shortcut: one shared test database, so files run serially; give each worker its own DB if the suite gets slow.
    fileParallelism: false,
  },
})
