/// <reference lib="webworker" />
// 推論用の Worker。STFT → 推論 → マスク → 逆STFT を 512 フレームずつ行う（1曲分のスペクトルを一度に持たないため）
import * as ort from 'onnxruntime-web'
import { BINS, HOP, N_FFT, istftFrameAdd, stftFrame } from './stft'
import type { Backend, HighBand, Stem, WorkerRequest, WorkerResponse } from './types'

/** モデルに1回で渡すフレーム数（モデルの入力の形で決まっている） */
const SPLIT = 512
/** モデルが扱う周波数ビンの数（約 11kHz まで） */
const MODEL_BINS = 1024
const EPS = 1e-10

let sessions: { vocals: ort.InferenceSession; accompaniment: ort.InferenceSession } | null = null

const post = (res: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(res, transfer)

async function init(vocals: ArrayBuffer, accompaniment: ArrayBuffer, backend: Backend) {
  // COOP/COEP の無い環境（GitHub Pages）ではマルチスレッドを使えないので 1 にする
  ort.env.wasm.numThreads = 1
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: [backend] }
  sessions = {
    vocals: await ort.InferenceSession.create(new Uint8Array(vocals), opts),
    accompaniment: await ort.InferenceSession.create(new Uint8Array(accompaniment), opts),
  }
}

/** `ch` は 44.1kHz のステレオ。`stem` の音だけを返す */
async function separate(id: number, ch: Float32Array[], stem: Stem, highBand: HighBand) {
  if (!sessions) throw new Error('not initialized')
  // 両端のフレームも窓の重なりが揃うよう、前後に N_FFT ずつ無音を足して処理し、最後に切り取る
  const n = ch[0].length
  const padded = ch.map((c) => {
    const p = new Float32Array(n + 2 * N_FFT)
    p.set(c, N_FFT)
    return p
  })
  const len = padded[0].length
  const frames = Math.floor((len - N_FFT) / HOP) + 1
  const out = padded.map(() => new Float32Array(len))
  const wsum = new Float32Array(len)
  const re = padded.map(() => Array.from({ length: SPLIT }, () => new Float32Array(BINS)))
  const im = padded.map(() => Array.from({ length: SPLIT }, () => new Float32Array(BINS)))
  const input = new Float32Array(2 * SPLIT * MODEL_BINS)
  const r = new Float32Array(BINS)
  const i_ = new Float32Array(BINS)

  for (let f0 = 0; f0 < frames; f0 += SPLIT) {
    const count = Math.min(SPLIT, frames - f0)
    input.fill(0)
    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < count; f++) {
        stftFrame(padded[c], f0 + f, re[c][f], im[c][f])
        const o = (c * SPLIT + f) * MODEL_BINS
        for (let k = 0; k < MODEL_BINS; k++) input[o + k] = Math.hypot(re[c][f][k], im[c][f][k])
      }
    }
    const x = new ort.Tensor('float32', input, [2, 1, SPLIT, MODEL_BINS])
    const v = (await sessions.vocals.run({ x })).y.data as Float32Array
    const a = (await sessions.accompaniment.run({ x })).y.data as Float32Array
    const [mine, other] = stem === 'vocals' ? [v, a] : [a, v]

    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < count; f++) {
        const o = (c * SPLIT + f) * MODEL_BINS
        for (let k = 0; k < BINS; k++) {
          // モデルが扱わない 1024 ビンより上は、0 にするか 1024 ビン目の値で延ばす
          let mask = 0
          if (k < MODEL_BINS || highBand === 'edge') {
            const kk = Math.min(k, MODEL_BINS - 1)
            const m = mine[o + kk] ** 2
            mask = (m + EPS / 2) / (m + other[o + kk] ** 2 + EPS)
          }
          r[k] = re[c][f][k] * mask
          i_[k] = im[c][f][k] * mask
        }
        istftFrameAdd(r, i_, f0 + f, out[c], c === 0 ? wsum : null)
      }
    }
    post({ id, progress: Math.min(1, (f0 + count) / frames) })
  }
  const result = out.map((y) => {
    const o = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const w = wsum[i + N_FFT]
      o[i] = w > 1e-8 ? y[i + N_FFT] / w : 0
    }
    return o
  })
  post({ id, channels: result }, result.map((c) => c.buffer))
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
