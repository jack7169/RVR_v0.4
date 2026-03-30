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
  },
})
