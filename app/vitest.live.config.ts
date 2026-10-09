import { defineConfig } from "vitest/config";

// Explicit opt-in configuration. The ordinary vitest.config.ts never includes .manual.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tools/acp-live.manual.ts"],
    testTimeout: 180000,
    hookTimeout: 15000,
    fileParallelism: false,
    retry: 0,
    reporters: ["verbose"],
    silent: false,
    disableConsoleIntercept: true,
  },
});
