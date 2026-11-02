import { defineConfig } from 'vitest/config';

const browserSuites = [
  'src/chippy-capabilities.test.ts',
  'src/chippy-headless.test.ts',
  'src/reload-with-avalanche.test.ts',
  'src/avalanche/detector.lifecycle.pw.test.ts',
  'src/chippy-stock-react.pw.test.ts',
  'src/chippy-library.pw.test.ts',
  'src/chippy-pack.pw.test.ts',
  'src/chippy-mcp.test.ts',
];

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: browserSuites,
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'node',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: browserSuites,
          // These suites share the local helper and app ports.
          fileParallelism: false,
        },
      },
    ],
  },
});
