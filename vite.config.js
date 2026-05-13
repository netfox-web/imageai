import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || process.env.APP_URL || 'http://localhost:3000';
const vitePort = Number(process.env.VITE_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    proxy: {
      '/api': apiTarget,
      '/studio': apiTarget,
      '/storage': apiTarget,
    },
  },
});
