/// <reference lib="webworker" />
// 推論用の Worker。STFT と逆STFT は dsp.wasm（dsp/ の Rust、wevocal-lib の STFT を使う）で行う。
// - Spleeter: STFT → 推論（ボーカル用・伴奏用）→ マスク → 逆STFT を 512 フレームずつ（1曲分のスペクトルを一度に持たないため）
// - MDX-Net: 区間ごとに STFT → 推論（取り出す音の複素スペクトログラム）→ 逆STFT。もう一方の音は元の音から引く（mdx.ts）
// - Demucs: 7.8 秒の区間ごとに、波形から音ごとの波形を推論する（STFT はモデルの中。demucs.ts）
import type * as Ort from 'onnxruntime-web'
import { GPU_FALLBACK, type Backend, type DemucsParams, type HighBand, type MdxParams, type ModelData, type Runtime, type Stem, type WorkerRequest, type WorkerResponse } from './types'
import { separateMdx } from './mdx'
import { DEMUCS_SEGMENT, separateDemucs } from './demucs'

/** STFT の設定。dsp/src/lib.rs の N_FFT / HOP と一致させる */
const N_FFT = 4096
const HOP = 1024
const BINS = N_FFT / 2 + 1
/** モデルに1回で渡すフレーム数（モデルの入力の形で決まっている） */
const SPLIT = 512
/** GPU で MDX-Net の区間を 1 回の推論にまとめる数 */
const MDX_GPU_BATCH = 2
/** モデルが扱う周波数ビンの数（約 11kHz まで。dsp/src/lib.rs の MODEL_BINS） */
const MODEL_BINS = 1024

export interface DspExports {
  memory: WebAssembly.Memory
  alloc_f32(len: number): number
  free_f32(ptr: number, len: number): void
  analyze_block(x: number, xLen: number, frame0: number, count: number, re: number, im: number, mag: number): void
  synthesize_block(
    re: number, im: number, mine: number, other: number, frame0: number, count: number,
    edge: number, out: number, outLen: number, wsum: number,
  ): void
  mdx_analyze(l: number, r: number, nFft: number, hop: number, dimF: number, dimT: number, tensor: number): void
  mdx_synthesize(tensor: number, nFft: number, hop: number, dimF: number, dimT: number, gain: number, l: number, r: number): void
}

/**
 * ONNX Runtime。WebGPU で動かすときは WebGPU 対応版（JSEP、28MB）、CPU だけなら WASM 版（14MB）を読み込む。
 * Safari 26 は JSEP 版の wasm を推論のあとに最適化し直す処理でメモリを使い、iOS でタブが落ちた（onnxruntime#26827。docs/COMPATIBILITY.md）。
 * どちらを読むかは最初の init の `runtime` で決まる（違う方が要るときは、index.ts が Worker を作り直す）
 */
let ort: typeof Ort
/** 読み込んだモデルのセッション */
type Loaded =
  | { kind: 'spleeter'; vocals: Ort.InferenceSession; accompaniment: Ort.InferenceSession }
  | { kind: 'mdx'; session: Ort.InferenceSession; params: MdxParams }
  | { kind: 'demucs'; session: Ort.InferenceSession; params: DemucsParams }
let loaded: Loaded | null = null
let dsp: DspExports | null = null
/** GPU で動かしているときは、出力がおかしければ CPU で作り直すためにモデルを持っておく */
let model: ModelData | null = null
let current: Backend = 'wasm'
/** GPU で処理できなかったら、CPU に切り替える前に呼び出し側に知らせる（`GPU_FALLBACK`） */
let askFallback = false

const post = (res: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer)

async function loadDsp(): Promise<DspExports> {
  const res = await fetch(new URL('./dsp.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {})
  return instance.exports as unknown as DspExports
}

async function init(m: ModelData, backend: Backend, memoryMb: number, runtime: Runtime, wasmUrl?: string, ask = false) {
  askFallback = ask
  // ONNX Runtime の wasm のメモリの上限（ortMemory.ts が書き換えた所で読む。最初の準備のときだけ効く）
  ;(globalThis as { __ortMaxPages?: number }).__ortMaxPages = Math.round(memoryMb * 16)
  // COOP/COEP の無い環境（GitHub Pages）ではマルチスレッドを使えないので 1 にする
  if (!ort) {
    ort = runtime === 'gpu' ? await import('onnxruntime-web') : await import('onnxruntime-web/wasm')
    // 追加機能として配るときは、wasm を別の追加機能に置くので場所を受け取る
    if (wasmUrl) ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  }
  ort.env.wasm.numThreads = 1
  dsp ??= await loadDsp()
  await release()
  model = m
  await createSessions(backend)
}

async function createSessions(backend: Backend) {
  const m = model
  if (!m) throw new Error('not initialized')
  // メモリを先回りして確保しない（iOS Safari はタブのメモリが少なく、先回りの確保で RangeError: Out of memory になりやすい）
  const opts: Ort.InferenceSession.SessionOptions = { executionProviders: [backend], enableCpuMemArena: false, enableMemPattern: false }
  // Demucs はグラフを最適化すると、作る途中で wasm のメモリが足りなくなる（std::bad_alloc。basic でも同じ。docs/MODELS.md）
  if (m.kind === 'demucs') opts.graphOptimizationLevel = 'disabled'
  const create = (buf: ArrayBuffer) => ort.InferenceSession.create(new Uint8Array(buf), opts)
  loaded =
    m.kind === 'spleeter'
      ? { kind: 'spleeter', vocals: await create(m.vocals), accompaniment: await create(m.accompaniment) }
      : m.kind === 'mdx'
        ? { kind: 'mdx', session: await create(m.model), params: m.params }
        : { kind: 'demucs', session: await create(m.model), params: m.params }
  current = backend
  if (backend === 'webgpu') void watchDevice()
  // CPU で動かすなら、作り直しに使うことはないので手放す（知らせるときは、確かめたあとでも作り直せるよう持っておく）
  if (backend === 'wasm') model = null
}

/** 見張っている WebGPU のデバイス（同じものを二重に見張らない） */
let watched: unknown = null

/**
 * WebGPU のデバイスが失われたら知らせる。ブラウザは、デバイスが何度も失われたサイトの WebGPU を、再起動まで止めることがある
 * （docs/COMPATIBILITY.md）。デバイスは ONNX Runtime が作ったもの（env.webgpu.device）
 */
async function watchDevice() {
  const dev = (await Promise.resolve((ort.env.webgpu as { device?: unknown }).device).catch(() => null)) as { lost?: Promise<{ reason?: string; message?: string }> } | null
  if (!dev?.lost || watched === dev) return
  watched = dev
  const info = await dev.lost
  // 手放したとき（destroy）は知らせない
  if (info.reason === 'destroyed') return
  post({ id: 0, deviceLost: info.message || info.reason || 'unknown' })
}

/** セッションを手放す。wasm のメモリ（ONNX Runtime と dsp.wasm）は残す */
async function release() {
  const s = loaded
  loaded = null
  model = null
  if (s?.kind === 'spleeter') await Promise.all([s.vocals.release(), s.accompaniment.release()])
  else if (s) await s.session.release()
}

/** 出力が使えるか（端末の GPU によっては、すべて 0 や NaN になることがある） */
export const usable = (y: Float32Array) => {
  let any = false
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) return false
    if (y[i] !== 0) any = true
  }
  return any
}

/**
 * `run` で推論する。`check` なら GPU の出力が使えるかを確かめ、GPU で失敗したり出力がおかしければ、CPU で作り直してやり直す。
 * 確かめられたら、作り直し用のモデルは手放す
 */
async function guarded<T extends Float32Array[]>(run: () => Promise<T>, check: boolean): Promise<T> {
  try {
    const out = await run()
    if (!check || current !== 'webgpu' || out.every(usable)) {
      if (check && !askFallback) model = null
      return out
    }
    if (askFallback) throw new Error(`${GPU_FALLBACK}output is not usable`)
  } catch (e) {
    if (current !== 'webgpu' || String(e).includes(GPU_FALLBACK)) throw e
    if (askFallback) throw new Error(`${GPU_FALLBACK}${String(e)}`)
  }
  await createSessions('wasm')
  return run()
}

/** 出力が使えるかを、まだ確かめていないか（GPU で動かしていて、作り直し用のモデルを持っている） */
const needsCheck = () => current === 'webgpu' && model !== null

/** `ch` は 44.1kHz のステレオ。`stems` の音を、その順に返す（推論は1回で、逆STFT だけ音ごとに行う） */
async function separate(id: number, ch: Float32Array[], stems: Stem[], highBand: HighBand) {
  if (!loaded || !dsp) throw new Error('not initialized')
  if (loaded.kind === 'demucs') {
    const infer = (x: Float32Array, check: boolean) =>
      guarded(async () => {
        const s = loaded
        if (s?.kind !== 'demucs') throw new Error('not initialized')
        const out = await s.session.run({ mix: new ort.Tensor('float32', x, [1, 2, DEMUCS_SEGMENT]) })
        return [out.stems.data as Float32Array]
      }, check).then(([y]) => y)
    const result = await separateDemucs(ch, stems, loaded.params, infer, needsCheck, (p) => post({ id, progress: p }))
    post({ id, stems: result }, result.flat().map((c) => c.buffer))
    return
  }
  if (loaded.kind === 'mdx') {
    const { params } = loaded
    const infer = (x: Float32Array, batch: number, check: boolean) =>
      guarded(async () => {
        const s = loaded
        if (s?.kind !== 'mdx') throw new Error('not initialized')
        const out = await s.session.run({ input: new ort.Tensor('float32', x, [batch, 4, params.dimF, params.dimT]) })
        return [out.output.data as Float32Array]
      }, check).then(([y]) => y)
    // GPU では区間をまとめて推論する（CPU ではまとめても速くならない。docs/MODELS.md）
    const batch = current === 'webgpu' ? MDX_GPU_BATCH : 1
    const result = await separateMdx(dsp, ch, stems, params, infer, needsCheck, (p) => post({ id, progress: p }), batch)
    post({ id, stems: result }, result.flat().map((c) => c.buffer))
    return
  }
  const d = dsp
  // 両端のフレームも窓の重なりが揃うよう、前後に N_FFT ずつ無音を足して処理し、最後に切り取る
  const n = ch[0].length
  const len = n + 2 * N_FFT
  const frames = Math.floor((len - N_FFT) / HOP) + 1
  const block = SPLIT * MODEL_BINS

  // wasm のメモリを先にすべて確保する（確保でメモリが増えると、前に作った view が無効になる）
  const allocs: [number, number][] = []
  const alloc = (size: number) => {
    const p = d.alloc_f32(size)
    allocs.push([p, size])
    return p
  }
  const input = [alloc(len), alloc(len)]
  const outs = stems.map(() => [alloc(len), alloc(len)])
  const wsum = alloc(len)
  const re = [alloc(SPLIT * BINS), alloc(SPLIT * BINS)]
  const im = [alloc(SPLIT * BINS), alloc(SPLIT * BINS)]
  const mag = alloc(2 * block)
  const mine = alloc(2 * block)
  const other = alloc(2 * block)
  // wasm の呼び出しの中でもメモリは増えうるので、view は使うたびに作る
  const view = (ptr: number, size: number) => new Float32Array(d.memory.buffer, ptr, size)

  try {
    for (let c = 0; c < 2; c++) view(input[c], len).set(ch[c], N_FFT)
    for (let f0 = 0; f0 < frames; f0 += SPLIT) {
      const count = Math.min(SPLIT, frames - f0)
      // 最後のブロックは短いので、残りのフレームを 0 にしておく
      view(mag, 2 * block).fill(0)
      for (let c = 0; c < 2; c++) d.analyze_block(input[c], len, f0, count, re[c], im[c], mag + c * block * 4)
      const x = new ort.Tensor('float32', view(mag, 2 * block).slice(), [2, 1, SPLIT, MODEL_BINS])
      // 最初のブロックで、GPU の出力が使えるかを確かめる（入力が無音なら確かめられないので次へ持ち越す）
      const silent = !usable(x.data as Float32Array)
      const [v, a] = await guarded(async () => {
        const s = loaded
        if (s?.kind !== 'spleeter') throw new Error('not initialized')
        return [(await s.vocals.run({ x })).y.data as Float32Array, (await s.accompaniment.run({ x })).y.data as Float32Array]
      }, !silent && needsCheck())
      for (const [si, stem] of stems.entries()) {
        view(mine, 2 * block).set(stem === 'vocals' ? v : a)
        view(other, 2 * block).set(stem === 'vocals' ? a : v)
        for (let c = 0; c < 2; c++) {
          // 窓の2乗の和は1つ目の音の1チャンネル分だけ足す（どれも同じ）
          d.synthesize_block(
            re[c], im[c], mine + c * block * 4, other + c * block * 4, f0, count,
            highBand === 'edge' ? 1 : 0, outs[si][c], len, si === 0 && c === 0 ? wsum : 0,
          )
        }
      }
      post({ id, progress: Math.min(1, (f0 + count) / frames) })
    }
    const w = view(wsum, len)
    const result = outs.map((out) => out.map((p) => {
      const y = view(p, len)
      const o = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const s = w[i + N_FFT]
        o[i] = s > 1e-8 ? y[i + N_FFT] / s : 0
      }
      return o
    }))
    post({ id, stems: result }, result.flat().map((c) => c.buffer))
  } finally {
    for (const [p, size] of allocs) d.free_f32(p, size)
  }
}

/**
 * 要求は届いた順に1つずつ行う（処理中に手放されないように）。
 * Worker は続けて使う間は止めない（作り直すと iOS で Out of memory になりやすい。docs/DECISIONS.md）
 */
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  queue = queue.then(async () => {
    try {
      if (req.kind === 'init') {
        await init(req.model, req.backend, req.memoryMb, req.runtime, req.wasmUrl, req.askFallback)
        post({ id: req.id, ok: true })
      } else if (req.kind === 'useCpu') {
        await createSessions('wasm')
        post({ id: req.id, ok: true })
      } else if (req.kind === 'release') {
        await release()
        post({ id: req.id, ok: true })
      } else {
        await separate(req.id, req.channels, req.stems, req.highBand)
      }
    } catch (err) {
      post({ id: req.id, error: String(err) })
    }
  })
}
