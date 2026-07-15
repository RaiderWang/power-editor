import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome105'],
    minify: process.env.TAURI_DEBUG ? false : true,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 800,
  },
})
