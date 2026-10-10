import { defineConfig } from 'vite'
import { ortMemory } from './ortMemory'

// 追加機能「ボーカル抽出の実行環境」（extractor/）を dist/addons/vocal-extractor/ にビルドする。アプリのフォルダーで実行する（WeVocalSynth と WeVocal Studio で共通）。
// アプリ本体とは別のファイル一式にし、導入した人だけが取得する（extractor/scripts/addons.mjs から呼ぶ）。
// ライブラリモードは wasm を JS に埋め込んでしまう（76MB になった）ので、通常のビルドで入口を index.js に固定する
export default defineConfig({
  // アプリの public/ はコピーしない
  publicDir: false,
  // 読み込み元（アプリの base）によらず、index.js からの相対パスで worker・wasm を探す
  base: './',
  build: {
    // 出力先は scripts/build-addons.mjs が決める（dist/addons か public/addons）
    outDir: `${process.env.ADDONS_OUT ?? 'dist/addons'}/vocal-extractor`,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: 'extractor/src/index.ts',
      // 公開している関数（createExtractor）を消さない
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'index.js' },
    },
  },
  // ONNX Runtime のメモリの上限を下げる（推論は Worker の中なので Worker のビルドに入れる）
  worker: { format: 'es', plugins: () => [ortMemory()] },
})
