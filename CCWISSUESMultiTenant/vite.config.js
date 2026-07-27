import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split big eager vendor libs into their own cached chunks. (jsPDF /
        // html2canvas are loaded on demand via dynamic import, so Rollup gives
        // them their own chunk automatically — no need to list them here.)
        manualChunks: {
          firebase: [
            'firebase/compat/app',
            'firebase/compat/auth',
            'firebase/compat/firestore',
            'firebase/compat/storage',
          ],
          'react-bootstrap': ['react-bootstrap'],
        },
      },
    },
  },
});
