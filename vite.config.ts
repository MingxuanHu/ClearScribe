import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 0 },
  server: {
    host: '127.0.0.1', port: Number(process.env.DEV_PORT || 5173), strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 4317}`, ws: true } },
  },
});
