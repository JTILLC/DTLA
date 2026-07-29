import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split big vendor libraries into their own cached chunks so they're
        // not bundled into the main app code.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
          charts: ['chart.js', 'react-chartjs-2'],
          datepicker: ['react-datepicker'],
        },
      },
    },
  },
});
