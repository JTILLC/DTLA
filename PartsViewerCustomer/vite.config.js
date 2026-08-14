import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Custom plugin to handle SPA routing
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // If the request is for /view/*, serve index.html
          if (req.url && req.url.startsWith('/view/')) {
            req.url = '/';
          }
          next();
        });
      }
    }
  ],
})
