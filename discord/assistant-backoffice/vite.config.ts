import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // In production the API and this app are served from the same origin
    // (see ../assistant-api); this proxy gives the dev server the same
    // same-origin behavior so `fetch('/api/...')` works unchanged.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
