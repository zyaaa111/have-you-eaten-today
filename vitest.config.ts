import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 55,
        branches: 40,
        functions: 55,
        lines: 55,
      },
      exclude: [
        "node_modules/**",
        "dist/**",
        ".next/**",
        "**/*.config.*",
        "**/*.d.ts",
        "scripts/**",
        "e2e/**",
        "lib/__tests__/**",
        "lib/seed.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
