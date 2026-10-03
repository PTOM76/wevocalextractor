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
/** GPU で動かしているときは、出力がおかしければ CPU で作り直すためにモデルを持っておく */
let models: { vocals: Uint8Array; accompaniment: Uint8Array } | null = null
let current: Backend = 'wasm'

const post = (res: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer)

async function loadDsp(): Promise<DspExports> {
  const res = await fetch(new URL('./dsp.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {})
  return instance.exports as unknown as DspExports
}

async function init(vocals: ArrayBuffer, accompaniment: ArrayBuffer, backend: Backend, memoryMb: number) {
  // ONNX Runtime の wasm のメモリの上限（ortMemory.ts が書き換えた所で読む。最初の準備のときだけ効く）
  ;(globalThis as { __ortMaxPages?: number }).__ortMaxPages = Math.round(memoryMb * 16)
  // COOP/COEP の無い環境（GitHub Pages）ではマルチスレッドを使えないので 1 にする
  ort.env.wasm.numThreads = 1
  dsp ??= await loadDsp()
  await release()
  models = { vocals: new Uint8Array(vocals), accompaniment: new Uint8Array(accompaniment) }
  await createSessions(backend)
}

async function createSessions(backend: Backend) {
  if (!models) throw new Error('not initialized')
  // メモリを先回りして確保しない（iOS Safari はタブのメモリが少なく、先回りの確保で RangeError: Out of memory になりやすい）
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: [backend], enableCpuMemArena: false, enableMemPattern: false }
  sessions = {
    vocals: await ort.InferenceSession.create(models.vocals, opts),
    accompaniment: await ort.InferenceSession.create(models.accompaniment, opts),
  }
  current = backend
  // CPU で動かすなら、作り直しに使うことはないので手放す
  if (backend === 'wasm') models = null
}

/** セッションを手放す。wasm のメモリ（ONNX Runtime と dsp.wasm）は残す */
async function release() {
  const s = sessions
  sessions = null
  models = null
  if (s) await Promise.all([s.vocals.release(), s.accompaniment.release()])
}

/** 止めるよう頼まれた separate の id */
const cancelled = new Set<number>()

/** 出力が使えるか（端末の GPU によっては、すべて 0 や NaN になることがある） */
const usable = (y: Float32Array) => {
  let any = false
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) return false
    if (y[i] !== 0) any = true
  }
  return any
}

/** 推論する。GPU で失敗したり出力がおかしければ、CPU で作り直してやり直す */
async function infer(x: ort.Tensor, check: boolean): Promise<{ v: Float32Array; a: Float32Array }> {
  const s = sessions!
  try {
    const v = (await s.vocals.run({ x })).y.data as Float32Array
    const a = (await s.accompaniment.run({ x })).y.data as Float32Array
    if (!check || current !== 'webgpu' || (usable(v) && usable(a))) {
      // 確かめられたら、作り直し用のモデルは手放す
      if (check) models = null
      return { v, a }
    }
  } catch (e) {
    if (current !== 'webgpu') throw e
  }
  await createSessions('wasm')
  return infer(x, false)
}

/** `ch` は 44.1kHz のステレオ。`stems` の音を、その順に返す（推論は1回で、逆STFT だけ音ごとに行う） */
async function separate(id: number, ch: Float32Array[], stems: Stem[], highBand: HighBand) {
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
      if (cancelled.delete(id)) throw new Error('cancelled')
      const count = Math.min(SPLIT, frames - f0)
      // 最後のブロックは短いので、残りのフレームを 0 にしておく
      view(mag, 2 * block).fill(0)
      for (let c = 0; c < 2; c++) d.analyze_block(input[c], len, f0, count, re[c], im[c], mag + c * block * 4)
      const x = new ort.Tensor('float32', view(mag, 2 * block).slice(), [2, 1, SPLIT, MODEL_BINS])
      // 最初のブロックで、GPU の出力が使えるかを確かめる（入力が無音なら確かめられないので次へ持ち越す）
      const silent = !usable(x.data as Float32Array)
      const { v, a } = await infer(x, !silent && current === 'webgpu' && models !== null)
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
 * 要求は届いた順に1つずつ行う（処理中に手放されないように）。止める要求だけはすぐに受け付ける。
 * Worker は止めずに使い続ける。iOS は上限 4GB の共有メモリを同時に 2 個までしか持てず、
 * 止めた Worker の分はすぐには返らないので、作り直すと Out of memory になる（docs/DECISIONS.md）
 */
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (req.kind === 'cancel') return void cancelled.add(req.target)
  queue = queue.then(async () => {
    try {
      if (req.kind === 'init') {
        await init(req.vocals, req.accompaniment, req.backend, req.memoryMb)
        post({ id: req.id, ok: true })
      } else if (req.kind === 'release') {
        await release()
        post({ id: req.id, ok: true })
      } else {
        await separate(req.id, req.channels, req.stems, req.highBand)
      }
    } catch (err) {
      post({ id: req.id, error: String(err) })
    } finally {
      if (req.kind === 'separate') cancelled.delete(req.id)
    }
  })
}