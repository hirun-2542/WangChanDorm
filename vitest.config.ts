import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("migrations");

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            SEAM_PROBE: "1",
            TEST_MIGRATIONS: migrations,
            LIFF_ID: "",
            LINE_CHANNEL_SECRET: "test-channel-secret",
            LINE_CHANNEL_ACCESS_TOKEN: "test-channel-access-token",
            SLIPOK_API_KEY: "",
            SLIPOK_BRANCH_ID: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
