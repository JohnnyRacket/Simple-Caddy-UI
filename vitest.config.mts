import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/*.test.ts"],
    environment: "node",
    // Tests share process.env and module state; run files one at a time
    fileParallelism: false,
  },
});
