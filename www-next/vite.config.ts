import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/cgi-bin': {
        target: 'http://192.168.1.1:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../www',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'vendor-charts';
          if (id.includes('node_modules/@tanstack')) return 'vendor-query';
          if (id.includes('node_modules/@radix-ui') || id.includes('node_modules/sonner') || id.includes('node_modules/lucide-react')) return 'vendor-ui';
        },
      },
    },
  },
})
