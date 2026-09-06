/**
 * clinic-lab 전용 Vite 서버.
 * 본 게임(src/**)을 다른 웨이브가 편집 중이므로, 그쪽 변경이 HMR full-reload로
 * 이 실험 페이지를 튕기게 하지 않도록 src 감시를 끄고 별도 포트로 띄운다.
 * 실행: npx vite --config lab/form/vite.lab.config.mjs   (cwd = frontend)
 */
import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../..')

export default defineConfig({
  root: frontend,
  plugins: [],
  // 공용 node_modules/.vite 를 건드리면 다른 웨이브의 dev 서버가 재최적화된다 → 전용 캐시
  cacheDir: path.resolve(frontend, 'node_modules/.vite-lab-form'),
  server: {
    port: 5191,
    strictPort: true,
    hmr: false,
    watch: { ignored: ['**/src/**', '**/node_modules/**', '**/public/**', '**/dist/**'] },
  },
})
