import { defineConfig } from 'vite';
import { motionStudio } from 'motion-studio';
export default defineConfig({
  plugins: [motionStudio()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
