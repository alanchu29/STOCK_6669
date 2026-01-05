import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/STOCK_6669/', // 這裡一定要對應你的 Repository 名稱
})