import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
    fileParallelism: false,  // SQLite DB shared across test files — must serialize
    setupFiles: ['./tests/setup.ts'],
  },
});
