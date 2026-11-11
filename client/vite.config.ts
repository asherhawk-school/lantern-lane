import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative paths, so the build works from any folder (GitHub Pages serves it under /lantern-lane/).
  base: './',
  plugins: [preact()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
