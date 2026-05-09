// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use Node environment (we're testing backend)
    environment: "node",

    // Test files pattern
    include: ["__tests__/**/*.test.js"],

    // Long timeout — mongodb-memory-server can be slow on first start
    testTimeout: 30000,
    hookTimeout: 30000,

    // Run tests in sequence (safer for MongoDB tests, no concurrency issues)
    fileParallelism: false,

    // Verbose output
    reporters: ["verbose"],

    // Don't crash on console.log
    silent: false,

    // Setup file run before each test file
    setupFiles: ["./__tests__/setup.js"],
  },
});
