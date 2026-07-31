import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The two CCW apps are the same application with a different shell: 60 of their
// source files were byte-identical and kept in sync by hand, which is a silent
// drift waiting to happen. Those now live in ../shared and are compiled into
// each app from there.
//
// `@app` matters as much as `@shared`: a few shared files import
// config/constants, which is NOT identical (the fork adds WORKSPACE_UID). The
// alias makes each app resolve its own, so sharing the component cannot quietly
// give one app the other's constants.
//
// The bare-package aliases are not decoration. ../shared sits outside both app
// roots, so Node resolution would walk up from there and find no node_modules
// at all; and if it found one, React would be present twice in a single bundle
// and every hook would throw. Pointing them at THIS app's copies fixes both.
//
// Every npm package imported from ../shared must be listed here, INCLUDING
// dynamic imports — heic-to is only reached via await import() and was missed
// on the first pass. Forgetting one fails the build with "failed to resolve
// import", which is the right failure: loud, immediate, and not shippable.
const appRoot = path.resolve(__dirname);
const pkg = (name) => path.resolve(appRoot, 'node_modules', name);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(appRoot, '../shared'),
      '@app': path.resolve(appRoot, 'src'),
      react: pkg('react'),
      'react-dom': pkg('react-dom'),
      'lucide-react': pkg('lucide-react'),
      'heic-to': pkg('heic-to'),
      firebase: pkg('firebase'),
    },
    dedupe: ['react', 'react-dom', 'firebase'],
  },
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
  test: {
    // The shared tests live with the shared code; both apps still run them, so
    // a break shows up wherever you happen to be working.
    include: ['src/**/*.test.{js,jsx}', '../shared/**/*.test.{js,jsx}'],
  },
});
