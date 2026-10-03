// UVR の MDX-Net での分離（worker.ts から呼ぶ）。docs/MODELS.md の「UVR の MDX-Net」。
// 曲の前後を `n_fft / 2` ずつ無音で延ばし、`hop × (dim_t − 1)` サンプルの区間を `gen`（区間 − n_fft）ずつずらして推論する。
// 区間の両端 `n_fft / 2` は窓の重なりが揃わないので捨て、真ん中の `gen` サンプルだけをつなぐ（UVR・sherpa-onnx と同じ）
import type { MdxParams, Stem } from './types'
import type { DspExports } from './worker'

/**
 * `ch`（44.1kHz のステレオ）を分け、`stems` の音をその順に返す。
 * `infer` はモデルの入力（4 × dimF × dimT）から出力を返す。`check` なら GPU の出力が使えるかを確かめる（worker.ts の `guarded`）
 */
export async function separateMdx(
  d: DspExports,
  ch: Float32Array[],
  stems: Stem[],
  p: MdxParams,
  infer: (x: Float32Array, check: boolean) => Promise<Float32Array>,
  needsCheck: () => boolean,
  onProgress: (p: number) => void,
): Promise<Float32Array[][]> {
  const n = ch[0].length
  const seg = p.hop * (p.dimT - 1)
  const trim = p.nFft / 2
  const gen = seg - 2 * trim
  const pad = gen - (n % gen)
  const total = trim + n + pad + trim
  // 前後を延ばした入力（左右）と、取り出した音（左右、長さ n + pad）
  const src = ch.map((c) => {
    const x = new Float32Array(total)
    x.set(c, trim)
    return x
  })
  const primary = [new Float32Array(n + pad), new Float32Array(n + pad)]
  const size = 4 * p.dimF * p.dimT

  // wasm のメモリを先にすべて確保する（確保でメモリが増えると、前に作った view が無効になる）
  const allocs: [number, number][] = []
  const alloc = (len: number) => {
    const ptr = d.alloc_f32(len)
    allocs.push([ptr, len])
    return ptr
  }
  const inL = alloc(seg)
  const inR = alloc(seg)
  const tensor = alloc(size)
  const outL = alloc(seg)
  const outR = alloc(seg)
  const view = (ptr: number, len: number) => new Float32Array(d.memory.buffer, ptr, len)

  try {
    const count = (n + pad) / gen
    for (let i = 0; i < count; i++) {
      const at = i * gen
      view(inL, seg).set(src[0].subarray(at, at + seg))
      view(inR, seg).set(src[1].subarray(at, at + seg))
      d.mdx_analyze(inL, inR, p.nFft, p.hop, p.dimF, p.dimT, tensor)
      const x = view(tensor, size).slice()
      // 無音の区間では GPU の出力を確かめられないので、次へ持ち越す
      const silent = !x.some((v) => v !== 0)
      const y = await infer(x, !silent && needsCheck())
      view(tensor, size).set(y)
      d.mdx_synthesize(tensor, p.nFft, p.hop, p.dimF, p.dimT, p.compensate, outL, outR)
      primary[0].set(view(outL, seg).subarray(trim, seg - trim), at)
      primary[1].set(view(outR, seg).subarray(trim, seg - trim), at)
      onProgress((i + 1) / count)
    }
  } finally {
    for (const [ptr, len] of allocs) d.free_f32(ptr, len)
  }

  // 取り出した音と、元の音から引いたもう一方の音
  const main = primary.map((c) => c.slice(0, n))
  const rest = main.map((c, k) => {
    const o = new Float32Array(n)
    const x = ch[k]
    for (let i = 0; i < n; i++) o[i] = x[i] - c[i]
    return o
  })
  return stems.map((s) => (s === p.primary ? main : rest))
}
