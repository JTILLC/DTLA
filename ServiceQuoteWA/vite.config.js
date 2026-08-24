import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Same alias the other apps use: customer identity rules live once in
  // ../shared. The bare-package aliases matter — ../shared sits outside this
  // app's root, so resolution walks up to the repo-level node_modules and a
  // second React ends up in the bundle, at which point every hook throws.
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
