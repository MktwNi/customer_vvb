/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any static host sub-path (GitHub Pages, Netlify, …)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
  // every test lets its worker read the replies waiting for it (src/test/yieldBetweenTests.ts)
  test: { setupFiles: ['./src/test/yieldBetweenTests.ts'] },
});
