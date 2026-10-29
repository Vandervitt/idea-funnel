import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/web',
  publicDir: 'public',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Keep the Host header so the API sees the browser's origin (CSRF check).
    proxy: { '/api/': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
});
