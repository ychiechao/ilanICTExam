import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings: {
      FIREBASE_SERVICE_ACCOUNT_B64: "",
      ALLOWED_ORIGINS: "https://presence-tests.invalid,https://other-tests.invalid",
    } },
  })],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 15000 },
});
