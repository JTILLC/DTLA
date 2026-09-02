import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // The tests are pure data checks on the navigation map and lessons; they
    // run in node and read files with fs, no DOM needed.
    environment: 'node',
  },
})
