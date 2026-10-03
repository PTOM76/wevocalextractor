import type { Plugin } from 'vite'

/**
 * ONNX Runtime Web が作る wasm のメモリの上限を 4GB から下げる（ビルド時に書き換える）。
 * WebKit は共有メモリの上限の分を、作った時点でプロセス全体の予約の枠（iOS で約 6GB）から差し引くので、
 * 4GB だと枠がすぐに尽きて RangeError: Out of memory になる（docs/DECISIONS.md）。
 * wasm は上限 4GB のメモリを読み込む宣言なので、それより小さい上限のメモリを渡しても動く
 */
const ORIGINAL = 'new WebAssembly.Memory({initial:256,maximum:65536,shared:!0})'

/** 上限（64KB 単位）。1GB。推論で実際に使うのは数百MB */
const MAX_PAGES = 16384

export function ortMemory(): Plugin {
  return {
    name: 'ort-memory',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !code.includes(ORIGINAL)) return null
      return { code: code.replace(ORIGINAL, `new WebAssembly.Memory({initial:256,maximum:${MAX_PAGES},shared:!0})`), map: null }
    },
    // 書き換える場所が見つからなければ（ONNX Runtime の更新で変わったら）ビルドを止める
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.code.includes('maximum:65536,shared:!0')) this.error('ortMemory: ONNX Runtime のメモリの上限を書き換えられなかった')
      }
    },
  }
}
