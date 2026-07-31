import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      // The parts lookup UI is shared with the two CCW apps. It carries its own
      // styling and takes its data layer by injection, so it works here despite
      // this app using Tailwind and the modular Firebase SDK.
      '@shared': path.resolve(__dirname, '../shared'),
      // ../shared is outside this app's root, so bare imports from there would
      // resolve against no node_modules at all — and a second React in one
      // bundle breaks every hook. Point them at this app's own copies.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
    },
    dedupe: ['react', 'react-dom'],
  },
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
