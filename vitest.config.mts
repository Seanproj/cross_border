import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          // DB tests share one database; run files sequentially.
          fileParallelism: false,
          globalSetup: ["tests/db/global-setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
