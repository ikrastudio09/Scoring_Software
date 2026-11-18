import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { BRAND, studioCredit } from '@cricket/shared';

// Fills the %BRAND_*% placeholders of index.html (the launch loader, title, meta) from the
// central branding config.
const brandHtml = {
  name: 'brand-html',
  transformIndexHtml: (html) => html
    .replaceAll('%BRAND_NAME%', BRAND.name)
    .replaceAll('%BRAND_SEASON%', String(BRAND.season))
    .replaceAll('%BRAND_YEAR%', String(BRAND.year))
    .replaceAll('%BRAND_LOGO%', BRAND.logo)
    .replaceAll('%BRAND_LAUNCH_BG%', BRAND.launchBackground)
    .replaceAll('%BRAND_CREDIT%', studioCredit()),
};

const api = process.env.VITE_DEV_API || 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 600 },
});
