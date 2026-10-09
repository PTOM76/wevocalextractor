import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }
import { APP_INFO } from './app/appInfo.ts'
import { ortMemory } from './ortMemory'

// 単体のサイト（app/）のビルド設定。ライブラリ（src/）は React に依存しないまま、app/ から使う
const root = dirname(fileURLToPath(import.meta.url))

/**
 * submodule（`name/`）の場所。`env` を指定するか、WeVocalSynth の submodule として隣にあればそちらを使う
 * （両方を直しながら開発できるように。こちらの submodule は todo setup:nested で隠す）
 */
function submodule(name: string, entry: string, env: string | undefined) {
  const sibling = resolve(root, '..', name)
  return env ?? (existsSync(resolve(sibling, entry)) ? sibling : resolve(root, name))
}
// PevenMUI（UI 部品）と wevocal-lib（音声ファイルの読み込み・書き出し。TypeScript 側は web/）
const pevenmui = submodule('pevenmui', 'src/index.ts', process.env.PEVENMUI_PATH)
// アプリの定義をビルドに渡すプラグイン（場所が決まるのは実行時なので、動的に読み込む。Node が .ts の型を取り除いて読む）
const { ISOLATION_SCRIPT, pevenApp, pevenIsolation, pevenManifest }: typeof import('../pevenmui/src/vite.ts') = await import(pathToFileURL(resolve(pevenmui, 'src/vite.ts')).href)
const wevocalLib = submodule('wevocal-lib', 'web/src/index.ts', process.env.WEVOCAL_LIB_PATH)

// 開発サーバーで、依存パッケージのファイル（onnxruntime-web の wasm・フォントなど）を配れるようにする。
// 実際に見つかった node_modules と、WeVocalSynth の submodule として開発するときの親の node_modules を許可する
// （隣の pevenmui・wevocal-lib から読み込むものは、親の node_modules から来る）
const nodeModules = [resolve(dirname(createRequire(import.meta.url).resolve('onnxruntime-web')), '../..'), resolve(root, '../node_modules')].filter((p) =>
  existsSync(p),
)

export default defineConfig({
  root: resolve(root, 'app'),
  // 配信先のサブパス（GitHub Pages など）は BASE_PATH で指定する
  base: process.env.BASE_PATH ?? '/',
  // 「このアプリについて」と設定に出すバージョン（package.json の version）とコミット
  // モデル（scripts/fetch-models.mjs が置く）
  publicDir: resolve(root, 'public'),
  resolve: {
    alias: [
      { find: /^pevenmui$/, replacement: resolve(pevenmui, 'src/index.ts') },
      { find: /^pevenmui\/pwa$/, replacement: resolve(pevenmui, 'src/pwa/index.ts') },
      { find: /^pevenmui\/web$/, replacement: resolve(pevenmui, 'src/web/index.ts') },
      { find: /^wevocal-lib$/, replacement: resolve(wevocalLib, 'web/src/index.ts') },
    ],
    // 外にある pevenmui から読み込む React・MUI も、このアプリと同じものにする（2つになると動かない）
    dedupe: ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled', '@fortawesome/react-fontawesome'],
  },
  server: { fs: { allow: [root, pevenmui, wevocalLib, ...nodeModules] } },
  // 開発サーバーで onnxruntime-web を事前バンドルすると、隣にあるはずの wasm の場所がずれ、
  // 代わりに index.html が返って読み込みに失敗する（expected magic word 00 61 73 6d）。そのまま読み込ませる
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  plugins: [
    react(),
    // 版（__APP_VERSION__、__APP_COMMIT__、version.json）と、index.html の名前、言語、配信先の URL（SITE_URL で指定）。WeVocalSynth と同じ
    pevenApp(APP_INFO, { version: pkg.version, root }),
    // wasm のマルチスレッドのため、cross-origin isolation にする（Synth の memo/wasm-threads.md）
    pevenIsolation(),
    VitePWA({
      // 新しい版は利用者が「更新」を押したときに切り替える（抽出中に勝手に再読み込みしない。UpdatePrompt 参照）
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        ...pevenManifest(APP_INFO),
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        inlineWorkboxRuntime: true,
        // ページの応答に COOP/COEP を足す（pevenIsolation）
        importScripts: [ISOLATION_SCRIPT],
        // 更新で切り替わったときに、名前の違う古い版のキャッシュを消す
        cleanupOutdatedCaches: true,
        // dsp.wasm もオフラインで使えるようにキャッシュする
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // モデルと ONNX Runtime の wasm（WebGPU 対応版 28MB、WASM 版 14MB）は全員に配らず、
        // 使ったものだけを app/models.ts が自分の保存先（Cache Storage）に入れる
        globIgnores: ['models/**', 'assets/ort-wasm-*.wasm'],
        navigateFallbackDenylist: [/\/models\//],
      },
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // wasm（dsp.wasm・ONNX Runtime）を JS に埋め込まない
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // 版ごとにほとんど変わらないライブラリを別のファイルにし、更新のときにアプリの部分だけ取り直せばよいようにする
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/, priority: 2 },
            { name: 'mui', test: /node_modules[\/](@mui|@emotion|@popperjs|stylis)/, priority: 1 },
          ],
        },
      },
    },
  },
  // ONNX Runtime のメモリの上限を下げる（推論は Worker の中なので Worker のビルドに入れる）
  worker: { format: 'es', plugins: () => [ortMemory()] },
})
