import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { qrcode: ['qrcode'], react: ['react', 'react-dom', 'react-dom/client'] },
      },
    },
  },
  server: {
    watch: { awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 } },
  },
});
