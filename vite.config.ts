import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 単体のサイト（app/）のビルド設定。ライブラリ（src/）は React に依存しないまま、app/ から使う
const root = dirname(fileURLToPath(import.meta.url))

// PevenMUI（UI 部品）は submodule の pevenmui/ を使う。
// PEVENMUI_PATH を指定するか、WeVocalSynth の submodule として隣に pevenmui があればそちらを使う（両方を直しながら開発できるように）
const sibling = resolve(root, '../pevenmui')
const pevenmui = process.env.PEVENMUI_PATH ?? (existsSync(resolve(sibling, 'src/index.ts')) ? sibling : resolve(root, 'pevenmui'))

export default defineConfig({
  root: resolve(root, 'app'),
  // 配信先のサブパス（GitHub Pages など）は BASE_PATH で指定する
  base: process.env.BASE_PATH ?? '/',
  // モデル（scripts/fetch-models.mjs が置く）
  publicDir: resolve(root, 'public'),
  resolve: {
    alias: { pevenmui: resolve(pevenmui, 'src/index.ts') },
    // 外にある pevenmui から読み込む React・MUI も、このアプリと同じものにする（2つになると動かない）
    dedupe: ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled', '@fortawesome/react-fontawesome'],
  },
  server: { fs: { allow: [root, pevenmui] } },
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // wasm（dsp.wasm・ONNX Runtime）を JS に埋め込まない
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
})
