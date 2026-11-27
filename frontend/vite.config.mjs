import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // changeOrigin must stay false: the API rejects non-GET requests whose
  // Origin header does not match the Host it receives. Vite's default
  // (string target) rewrites Host to 127.0.0.1:4173 while the browser keeps
  // sending Origin http://127.0.0.1:5173, so every POST/PATCH/DELETE failed
  // with 403 "Origen no permitido." through the dev server.
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4173', changeOrigin: false },
      '/uploads': { target: 'http://127.0.0.1:4173', changeOrigin: false },
    },
  },
});
