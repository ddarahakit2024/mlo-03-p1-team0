import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // This app uses plain CSS; skip auto-discovery of unrelated PostCSS configs.
  css: { postcss: { plugins: [] } },
  server: { host: '0.0.0.0', port: 5173 },
})
