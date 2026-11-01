import { defineConfig } from "vitest/config";

// Tests start from the four demo disputes only; history has its own test.
export default defineConfig({ test: { env: { REBUTTAL_SEED_HISTORY: "0" } } });
