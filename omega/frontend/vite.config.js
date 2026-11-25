import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
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
