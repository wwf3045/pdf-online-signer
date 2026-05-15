import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '::',
    hmr: {
      host: 'websocket.ecs.wwfeng3045.top',
      protocol: 'wss',
      clientPort: 443
    },
    allowedHosts: [
	'sign.wwfeng3045.top',
    	'sign.ecs.wwfeng3045.top',
	'pdf.wwfeng3045.top',
	'test.ecs.wwfeng3045.top',
	'websocket.ecs.wwfeng3045.top',
	'sign.pdf.wwfeng3045.top',
	'api.pdf.wwfeng3045.top'
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
