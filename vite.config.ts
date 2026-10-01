import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

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
const wevocalLib = submodule('wevocal-lib', 'web/src/index.ts', process.env.WEVOCAL_LIB_PATH)

// 開発サーバーで、依存パッケージのファイル（onnxruntime-web の wasm・フォントなど）を配れるようにする。
// 実際に見つかった node_modules と、WeVocalSynth の submodule として開発するときの親の node_modules を許可する
// （隣の pevenmui・wevocal-lib から読み込むものは、親の node_modules から来る）
const nodeModules = [resolve(dirname(createRequire(import.meta.url).resolve('onnxruntime-web')), '../..'), resolve(root, '../node_modules')].filter((p) =>
  existsSync(p),
)

/**
 * ビルドしたコミットの短いハッシュ。バージョン番号を上げずにデプロイしても、どの版か分かるようにする
 * （CI では GITHUB_SHA、手元では git から。取れなければ dev）
 */
function commitHash(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}
const commit = commitHash()

/** OGP に使う配信先の絶対 URL（末尾 /）。CI から SITE_URL で指定する。無ければ公開中の URL */
const siteUrl = (process.env.SITE_URL ?? 'https://wevocalextractor.pitan76.net/').replace(/\/?$/, '/')

export default defineConfig({
  root: resolve(root, 'app'),
  // 配信先のサブパス（GitHub Pages など）は BASE_PATH で指定する
  base: process.env.BASE_PATH ?? '/',
  // 「このアプリについて」と設定に出すバージョン（package.json の version）とコミット
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(commit) },
  // モデル（scripts/fetch-models.mjs が置く）
  publicDir: resolve(root, 'public'),
  resolve: {
    alias: [
      { find: /^pevenmui$/, replacement: resolve(pevenmui, 'src/index.ts') },
      { find: /^pevenmui\/pwa$/, replacement: resolve(pevenmui, 'src/pwa/index.ts') },
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
    // OGP のメタタグは絶対 URL が要るので、index.html の %SITE_URL% を置き換える
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
    },
    // 更新の通知で「どの版が来たか」を出すため、配信中の版を version.json に書く（オフライン用のキャッシュには入れない）
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, commit }) })
      },
    },
    VitePWA({
      // 新しい版は利用者が「更新」を押したときに切り替える（抽出中に勝手に再読み込みしない。UpdatePrompt 参照）
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'WeVocalExtractor',
        short_name: 'WeVocalExtractor',
        description: '曲からボーカルと伴奏を取り出す Web ツール',
        lang: 'ja',
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
        // ONNX Runtime の wasm（約 28MB）もオフラインで使えるようにキャッシュする
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        // モデルは全員に配らず、使った種類だけを app/models.ts が自分の保存先（Cache Storage）に入れる
        globIgnores: ['models/**'],
        navigateFallbackDenylist: [/\/models\//],
      },
    }),
  ],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // wasm（dsp.wasm・ONNX Runtime）を JS に埋め込まない
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
})
