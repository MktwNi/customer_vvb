import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any static host sub-path (GitHub Pages, Netlify, …)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
});
