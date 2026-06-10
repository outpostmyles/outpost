import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Pin the React runtime into its own chunk. It almost never changes, so a
        // normal app-code deploy leaves this hash stable and returning users keep
        // it from cache instead of re-downloading React every release. recharts is
        // deliberately NOT listed here: it is dynamically imported (GrowthChartCanvas)
        // and must stay in its own on-demand chunk, not get pulled into vendor.
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
