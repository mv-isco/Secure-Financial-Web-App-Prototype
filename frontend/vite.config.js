import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const headers = { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, headers, proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } } },
  preview: { headers },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  test: { environment: 'jsdom', setupFiles: [], restoreMocks: true },
});
