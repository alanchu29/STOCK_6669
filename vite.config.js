import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/stock-analysis-app/' : '/', // 如果 GitHub repo 名稱不是 stock-analysis-app，請修改這裡
})

