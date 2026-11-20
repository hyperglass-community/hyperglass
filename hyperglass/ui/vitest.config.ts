/// <reference types="vitest" />

import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'cobertura', 'json-summary'],
      reportsDirectory: './coverage',
      // Count every source file, not only those a test happens to load, so the
      // number does not move when a test starts importing another module.
      include: [
        'components/**/*.{ts,tsx}',
        'context/**/*.{ts,tsx}',
        'elements/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'pages/**/*.{ts,tsx}',
        'types/**/*.ts',
        'util/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './'),
    },
  },
});
