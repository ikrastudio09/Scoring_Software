import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.VITE_DEV_API || 'http://localhost:4000';

export default defineConfig({
  base: '/led/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: { '/api': api, '/socket.io': { target: api, ws: true } },
  },
});
