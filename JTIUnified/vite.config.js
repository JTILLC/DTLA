import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  // The same alias the CCW apps use, so genuinely shared pieces — the
  // stale-build banner among them — exist once rather than as three copies
  // that drift apart.
  //
  // The bare-package aliases are not decoration, and the CCW configs say so
  // for the same reason: ../shared sits outside this app's root, so Node
  // resolution walks UP from there and finds the repo-level node_modules — a
  // second React in one bundle, whose dispatcher is null, so every hook throws
  // "Cannot read properties of null (reading 'useState')" and the whole
  // dashboard goes to its error boundary. Pointing them at THIS app's copies
  // is what stops that.
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
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
  // The shared tests live with the shared code, and this app runs them too.
  // That is the entire point of moving customer identity into ../shared: a
  // rule three apps must agree on cannot have its only test in one app's
  // suite, or a change made in another app passes its own tests, ships, and
  // the guard never executes. That exact failure white-screened Headcount
  // earlier this month.
  test: {
    include: ['src/**/*.test.{js,jsx}', '../shared/utils/customer*.test.{js,jsx}'],
  },
})