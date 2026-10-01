/// <reference lib="webworker" />
// 推論用の Worker。STFT → 推論 → マスク → 逆STFT を 512 フレームずつ行う（1曲分のスペクトルを一度に持たないため）。
// STFT と、マスクを掛けての逆STFT は dsp.wasm（dsp/ の Rust、wevocal-lib の STFT を使う）で行う
import * as ort from 'onnxruntime-web'
import type { Backend, HighBand, Stem, WorkerRequest, WorkerResponse } from './types'

/** STFT の設定。dsp/src/lib.rs の N_FFT / HOP と一致させる */
const N_FFT = 4096
const HOP = 1024
const BINS = N_FFT / 2 + 1
/** モデルに1回で渡すフレーム数（モデルの入力の形で決まっている） */
const SPLIT = 512
/** モデルが扱う周波数ビンの数（約 11kHz まで。dsp/src/lib.rs の MODEL_BINS） */
const MODEL_BINS = 1024

interface DspExports {
  memory: WebAssembly.Memory
  alloc_f32(len: number): number
  free_f32(ptr: number, len: number): void
  analyze_block(x: number, xLen: number, frame0: number, count: number, re: number, im: number, mag: number): void
  synthesize_block(
    re: number, im: number, mine: number, other: number, frame0: number, count: number,
    edge: number, out: number, outLen: number, wsum: number,
  ): void
}

let sessions: { vocals: ort.InferenceSession; accompaniment: ort.InferenceSession } | null = null
let dsp: DspExports | null = null

const post = (res: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer)

async function loadDsp(): Promise<DspExports> {
  const res = await fetch(new URL('./dsp.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {})
  return instance.exports as unknown as DspExports
}

async function init(vocals: ArrayBuffer, accompaniment: ArrayBuffer, backend: Backend) {
  // COOP/COEP の無い環境（GitHub Pages）ではマルチスレッドを使えないので 1 にする
  ort.env.wasm.numThreads = 1
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: [backend] }
  dsp = await loadDsp()
  sessions = {
    vocals: await ort.InferenceSession.create(new Uint8Array(vocals), opts),
    accompaniment: await ort.InferenceSession.create(new Uint8Array(accompaniment), opts),
  }
}

/** `ch` は 44.1kHz のステレオ。`stem` の音だけを返す */
async function separate(id: number, ch: Float32Array[], stem: Stem, highBand: HighBand) {
  if (!sessions || !dsp) throw new Error('not initialized')
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
  const out = [alloc(len), alloc(len)]
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
      const v = (await sessions.vocals.run({ x })).y.data as Float32Array
      const a = (await sessions.accompaniment.run({ x })).y.data as Float32Array
      view(mine, 2 * block).set(stem === 'vocals' ? v : a)
      view(other, 2 * block).set(stem === 'vocals' ? a : v)
      for (let c = 0; c < 2; c++) {
        // 窓の2乗の和は1チャンネル分だけ足す（両チャンネルで同じ）
        d.synthesize_block(
          re[c], im[c], mine + c * block * 4, other + c * block * 4, f0, count,
          highBand === 'edge' ? 1 : 0, out[c], len, c === 0 ? wsum : 0,
        )
      }
      post({ id, progress: Math.min(1, (f0 + count) / frames) })
    }
    const w = view(wsum, len)
    const result = out.map((p) => {
      const y = view(p, len)
      const o = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const s = w[i + N_FFT]
        o[i] = s > 1e-8 ? y[i + N_FFT] / s : 0
      }
      return o
    })
    post({ id, channels: result }, result.map((c) => c.buffer))
  } finally {
    for (const [p, size] of allocs) d.free_f32(p, size)
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    if (req.kind === 'init') {
      await init(req.vocals, req.accompaniment, req.backend)
      post({ id: req.id, ok: true })
    } else {
      await separate(req.id, req.channels, req.stem, req.highBand)
    }
  } catch (err) {
    post({ id: req.id, error: String(err) })
  }
}
