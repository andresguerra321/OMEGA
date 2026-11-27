import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function routeDesktopGoogleCallback(server) {
  server.middlewares.use((req, res, next) => {
    const callback = new URL(req.url || '/', 'http://localhost');
    if (callback.pathname === '/google/callback' && /^D_[A-Za-z0-9_-]{41}$/.test(callback.searchParams.get('state') || '')) {
      req.url = `/google-desktop-return.html${callback.search}`;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
    }
    next();
  });
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'omega-google-desktop-return',
    configureServer: routeDesktopGoogleCallback,
    configurePreviewServer: routeDesktopGoogleCallback,
  }],
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-three', test: /node_modules[\\/](three|@react-three|postprocessing|three-stdlib|maath|troika)/ },
            { name: 'vendor-motion', test: /node_modules[\\/]framer-motion/ },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)/ },
            { name: 'vendor-markdown', test: /node_modules[\\/](react-markdown|remark-gfm|unified|mdast|micromark|hast)/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
            { name: 'vendor-qrcode', test: /node_modules[\\/]qrcode/ },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/actuator': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
