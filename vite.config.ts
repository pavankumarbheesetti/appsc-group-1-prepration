/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Offline-first build:
// vite-plugin-singlefile inlines all JS/CSS into one self-contained index.html
// so the production bundle opens by double-clicking on file:// with no server.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    // Keep everything in a single chunk and inline all assets.
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // inline all assets regardless of size
    // Do not split into vendor chunks; singlefile needs one bundle.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  // Vitest configuration (jsdom for DOM APIs in future view tests).
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
