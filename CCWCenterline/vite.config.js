import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Most tests are pure data — parsing an RCU export, matching a read field
    // to the map, laying out a document. Anything needing a DOM is named
    // *.dom.test.jsx, matching the timesheet app's split.
    environment: 'node',
    environmentMatchGlobs: [['**/*.dom.test.jsx', 'jsdom']],
  },
})
