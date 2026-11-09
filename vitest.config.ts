import { defineConfig } from 'vitest/config';

const browserSuites = [
  'src/__tests__/chippy-capabilities.test.ts',
  'src/__tests__/chippy-headless.test.ts',
  'src/__tests__/reload-with-avalanche.test.ts',
  'src/avalanche/detector.lifecycle.pw.test.ts',
  'src/__tests__/chippy-stock-react.pw.test.ts',
  'src/__tests__/chippy-production-names.pw.test.ts',
  'src/__tests__/chippy-proxy.pw.test.ts',
  'src/__tests__/chippy-vite-sources.pw.test.ts',
  'src/__tests__/chippy-extension-armed-reload.pw.test.ts',
  'src/__tests__/chippy-storybook-addon.pw.test.ts',
  'src/__tests__/chippy-library.pw.test.ts',
  'src/__tests__/chippy-pack.pw.test.ts',
  'src/__tests__/chippy-mcp.test.ts',
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
