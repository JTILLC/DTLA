import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// ../shared holds the code this app has in common with the CCW apps — starting
// with how a replaced part and its quantity are read, which has to agree
// exactly with what those apps wrote.
//
// The react aliases are here even though the first shared import is a plain
// function with no dependencies. ../shared sits outside this app's root, so
// Node resolution from there finds no node_modules; and the day someone imports
// a shared *component*, an un-aliased React would be bundled twice and every
// hook would throw. Cheaper to be correct now than to debug that later.
const pkg = (name) => path.resolve(__dirname, 'node_modules', name)

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      react: pkg('react'),
      'react-dom': pkg('react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
