// Demucs（htdemucs）での分離（worker.ts から呼ぶ）。docs/MODELS.md の「Demucs」。
// モデルは 7.8 秒（343980 サンプル）の波形をそのまま受け取り、音ごとの波形を返す（STFT はモデルの中）。
// 曲を 1/4 ずつ重ねた区間に分けて推論し、重なる所は直線で入れ替えて足す（Demucs の元の実装、ONNX 版の infer.py と同じ）
import type { DemucsParams, Stem } from './types'

/** モデルの入力の長さ（サンプル。44.1kHz で 7.8 秒） */
export const DEMUCS_SEGMENT = 343980
const OVERLAP = DEMUCS_SEGMENT / 4
const STRIDE = DEMUCS_SEGMENT - OVERLAP

/**
 * `ch`（44.1kHz のステレオ）を分け、`stems` の音をその順に返す。`accompaniment` はボーカル以外の和（元の音からボーカルを引く）。
 * `infer` はモデルの入力（2 × DEMUCS_SEGMENT）から出力（音の数 × 2 × DEMUCS_SEGMENT）を返す。
 * `check` なら GPU の出力が使えるかを確かめる（worker.ts の `guarded`）
 */
export async function separateDemucs(
  ch: Float32Array[],
  stems: Stem[],
  p: DemucsParams,
  infer: (x: Float32Array, check: boolean) => Promise<Float32Array>,
  needsCheck: () => boolean,
  onProgress: (p: number) => void,
): Promise<Float32Array[][]> {
  const n = ch[0].length
  // 要る音だけを足し合わせる（3 分の曲で 1 つ 64MB。全部持つと 6 つで 380MB になる）
  const need = [...new Set(stems.map((s) => (s === 'accompaniment' ? 'vocals' : s)))]
  const index = need.map((s) => {
    const i = p.sources.indexOf(s as DemucsParams['sources'][number])
    if (i < 0) throw new Error(`this model does not output ${s}`)
    return i
  })
  const sums = need.map(() => [new Float32Array(n), new Float32Array(n)])
  const weight = new Float32Array(n)
  const count = Math.max(1, Math.ceil(Math.max(0, n - OVERLAP) / STRIDE))
  const x = new Float32Array(2 * DEMUCS_SEGMENT)
  for (let i = 0; i < count; i++) {
    const start = i * STRIDE
    const len = Math.min(DEMUCS_SEGMENT, n - start)
    x.fill(0)
    x.set(ch[0].subarray(start, start + len), 0)
    x.set(ch[1].subarray(start, start + len), DEMUCS_SEGMENT)
    // 無音の区間では GPU の出力を確かめられないので、次へ持ち越す
    const silent = !x.some((v) => v !== 0)
    const y = await infer(x.slice(), !silent && needsCheck())
    for (let t = 0; t < len; t++) {
      // 重なる所は直線で入れ替える。曲の頭と終わりは小さくしない
      const fadeIn = i === 0 ? 1 : Math.min(1, (t + 1) / OVERLAP)
      const fadeOut = i === count - 1 ? 1 : Math.min(1, (DEMUCS_SEGMENT - t) / OVERLAP)
      const w = Math.min(fadeIn, fadeOut)
      weight[start + t] += w
      for (const [k, si] of index.entries()) {
        for (let c = 0; c < 2; c++) sums[k][c][start + t] += w * y[(si * 2 + c) * DEMUCS_SEGMENT + t]
      }
    }
    onProgress((i + 1) / count)
  }
  for (const s of sums) {
    for (const c of s) {
      for (let t = 0; t < n; t++) c[t] /= weight[t] || 1
    }
  }
  return stems.map((s) => {
    if (s !== 'accompaniment') return sums[need.indexOf(s)]
    // ボーカル以外の和は、元の音からボーカルを引いたもの（モデルの出力の和は元の音とほぼ同じ。-30dB 程度の差）
    const v = sums[need.indexOf('vocals')]
    return ch.map((c, k) => {
      const o = new Float32Array(n)
      for (let t = 0; t < n; t++) o[t] = c[t] - v[k][t]
      return o
    })
  })
}
