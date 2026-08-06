import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.md'],
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party libraries into their own long-lived cache
        // chunks so the frequently-changing app code doesn't force a
        // re-download of Firebase/React on every deploy.
        manualChunks: {
          'vendor-firebase': ['firebase/app', 'firebase/firestore', 'firebase/storage', 'firebase/database', 'firebase/auth'],
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
})
