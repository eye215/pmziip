import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/preview",
  use: { ...base.use, baseURL: "http://127.0.0.1:4311" },
  webServer: {
    command: "node scripts/serve-preview.mjs",
    url: "http://127.0.0.1:4311/pmziip/",
    reuseExistingServer: false,
  },
});
