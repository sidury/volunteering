import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "/tmp/e2e-output",
  use: { baseURL: "http://localhost:18081", viewport: { width: 1440, height: 900 }, trace: "off" },
});
