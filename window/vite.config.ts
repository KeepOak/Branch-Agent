/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { allow: ['..'] } },
  test: { environment: 'jsdom' },
})
