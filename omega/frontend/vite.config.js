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
            { name: 'vendor-three', test: /node_modules[\\/]three/ },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)/ },
            { name: 'vendor-markdown', test: /node_modules[\\/](react-markdown|remark-gfm|unified|mdast|micromark|hast)/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
