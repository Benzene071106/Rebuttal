import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests start from the four demo disputes only; history has its own test.
// The "@/" alias matches tsconfig, so route handlers can be tested directly.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { env: { REBUTTAL_SEED_HISTORY: "0" } },
});
