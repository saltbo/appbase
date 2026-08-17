import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
