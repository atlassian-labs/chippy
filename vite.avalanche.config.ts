import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Single browser build for Chippy's shipped avalanche adapter.
// Output remains dist/avalanche.iife.js for extension manifest compatibility.

export default defineConfig({
  define: {
    // Vendored upstream code references process.env.NODE_ENV. Strip it at build time
    // so the IIFE has no unresolved Node globals.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  esbuild: {
    // detector.tsx uses TS-only syntax and JSX-free code; emit JSX as no-op since none present.
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    target: 'es2020',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/iife.ts'),
      name: '__AVALANCHE__',
      formats: ['iife', 'es'],
      fileName: (format) => {
        if (format === 'es') return 'avalanche.es.js';
        return 'avalanche.iife.js';
      },
    },
    rollupOptions: {
      // No externals — produce a self-contained bundle.
      external: [],
      output: {
        extend: true,
      },
    },
  },
});
