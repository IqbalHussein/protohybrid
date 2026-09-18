import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The suite covers `src/lib` only: those modules are deliberately free of
// React, Next and Supabase so the training rules — volume, PRs, week math,
// grid layout — can be checked without a database or a rendered page.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
