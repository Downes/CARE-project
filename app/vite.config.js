import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    // In dev mode, proxy API calls to the backend
    proxy: {
      '/addfile': 'http://localhost:3002',
      '/getfile': 'http://localhost:3002',
    },
  },
});
