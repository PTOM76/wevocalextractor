/**
 * WeVocalExtractor: 曲からボーカル（または伴奏）を取り出す。UI を持たず、React にも依存しない（docs/DESIGN.md。画面は app/）。
 * 受け渡しはチャンネルごとの Float32Array とサンプルレートだけ。推論は専用の Worker で行う。
 */
import type { Backend, HighBand, Stem, WorkerRequest, WorkerResponse } from './types'

export type { Backend, HighBand, Stem }

/** モデル（Spleeter 2stems）のサンプルレート */
const MODEL_RATE = 44100

export interface ExtractorOptions {
  /** ボーカル用・伴奏用のモデル（ONNX） */
  vocals: ArrayBuffer
  accompaniment: ArrayBuffer
  backend: Backend
}

export interface SeparateOptions {
  stem: Stem
  highBand?: HighBand
  onProgress?: (p: number) => void
}

export interface Extractor {
  /** `channels`（`sampleRate` Hz）から `stem` の音を取り出す。結果は入力と同じサンプルレート・チャンネル数・長さ */
  separate(channels: Float32Array[], sampleRate: number, opts: SeparateOptions): Promise<Float32Array[]>
  /** ボーカルと伴奏の両方を取り出す（推論は1回なので、separate を2回呼ぶより速い） */
  separateBoth(
    channels: Float32Array[],
    sampleRate: number,
    opts: Omit<SeparateOptions, 'stem'>,
  ): Promise<{ vocals: Float32Array[]; accompaniment: Float32Array[] }>
  dispose(): void
}

/** `channels` を `to` Hz の `outCh` チャンネルに変換する（ブラウザの OfflineAudioContext を使う） */
async function convert(channels: Float32Array[], from: number, to: number, outCh: number): Promise<Float32Array[]> {
  if (from === to && channels.length === outCh) return channels
  const n = channels[0].length
  const ctx = new OfflineAudioContext(outCh, Math.max(1, Math.round((n * to) / from)), to)
  const buf = ctx.createBuffer(channels.length, n, from)
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  const src = ctx.createBufferSource()
  src.buffer = buf
  // モノラル → ステレオは同じ音を両方に入れる（既定のアップミックス）。ステレオ → モノラルは平均
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return Array.from({ length: outCh }, (_, i) => out.getChannelData(i))
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }

/**
 * 推論の Worker（ページで1つ）。手放しても止めずに、次の createExtractor で使い回す。
 * iOS は上限 4GB の共有メモリ（ONNX Runtime が作る）を同時に 2 個までしか持てず、
 * 止めた Worker の分はすぐには返らないので、作り直すと RangeError: Out of memory になる
 */
let shared: { worker: Worker; pending: Map<number, Pending>; nextId: number; owner: object | null } | null = null

function sharedWorker() {
  if (shared) return shared
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const s = { worker, pending: new Map<number, Pending>(), nextId: 1, owner: null as object | null }
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = s.pending.get(e.data.id)
    if (!p) return
    if ('progress' in e.data) return p.onProgress?.(e.data.progress)
    s.pending.delete(e.data.id)
    if ('error' in e.data) p.reject(new Error(e.data.error))
    else p.resolve(e.data)
  }
  // Worker が落ちたら、次は作り直す
  worker.onerror = (e) => {
    s.pending.forEach((p) => p.reject(new Error(e.message || 'extractor worker error')))
    s.pending.clear()
    worker.terminate()
    if (shared === s) shared = null
  }
  return (shared = s)
}

/** 実行環境を作る。前に作ったものは使えなくなる（Worker は1つで、モデルを入れ替える） */
export async function createExtractor(opts: ExtractorOptions): Promise<Extractor> {
  const s = sharedWorker()
  /** この実行環境が送った要求の id（手放すときに止める） */
  const mine = new Set<number>()
  let disposed = false
  // Worker のモデルの持ち主。あとから作ったものに入れ替わっていたら、手放すときにモデルを消さない
  const token = {}
  s.owner = token
  const send = (req: WorkerRequest, transfer: Transferable[], onProgress?: (p: number) => void) =>
    new Promise<WorkerResponse>((resolve, reject) => {
      if (disposed) return reject(new DOMException('disposed', 'AbortError'))
      mine.add(req.id)
      const done = () => mine.delete(req.id)
      s.pending.set(req.id, { resolve: (r) => (done(), resolve(r)), reject: (e) => (done(), reject(e)), onProgress })
      s.worker.postMessage(req, transfer)
    })

  // モデルは Worker に移すので、呼び出し元の ArrayBuffer は使えなくなる
  await send({ kind: 'init', id: s.nextId++, vocals: opts.vocals, accompaniment: opts.accompaniment, backend: opts.backend }, [
    opts.vocals,
    opts.accompaniment,
  ])
  /** `stems` の音を、入力と同じサンプルレート・チャンネル数・長さで返す */
  const run = async (channels: Float32Array[], sampleRate: number, stems: Stem[], o: Omit<SeparateOptions, 'stem'>) => {
    const n = channels[0].length
    const input = await convert(channels, sampleRate, MODEL_RATE, 2)
    // 変換しなかった場合は呼び出し元の配列なので、コピーしてから Worker に移す
    const owned = input === channels ? input.map((c) => c.slice()) : input
    const res = await send(
      { kind: 'separate', id: s.nextId++, channels: owned, stems, highBand: o.highBand ?? 'zeros' },
      owned.map((c) => c.buffer),
      o.onProgress,
    )
    if (!('stems' in res)) throw new Error('unexpected response')
    return Promise.all(
      res.stems.map(async (st) => {
        const back = await convert(st, MODEL_RATE, sampleRate, channels.length)
        // サンプルレートの変換で 1 サンプル程度ずれることがあるので、入力と同じ長さにそろえる
        return back.map((c) => {
          if (c.length === n) return c
          const o2 = new Float32Array(n)
          o2.set(c.subarray(0, n))
          return o2
        })
      }),
    )
  }

  return {
    async separate(channels, sampleRate, o) {
      const [one] = await run(channels, sampleRate, [o.stem], o)
      return one
    },
    async separateBoth(channels, sampleRate, o) {
      const [vocals, accompaniment] = await run(channels, sampleRate, ['vocals', 'accompaniment'], o)
      return { vocals, accompaniment }
    },
    dispose() {
      if (disposed) return
      disposed = true
      // 処理中の separate は待ち続けないよう失敗させ（中断に使える）、Worker には止めて手放すよう頼む
      for (const id of mine) {
        s.worker.postMessage({ kind: 'cancel', id: s.nextId++, target: id } satisfies WorkerRequest)
        s.pending.get(id)?.reject(new DOMException('disposed', 'AbortError'))
        s.pending.delete(id)
      }
      mine.clear()
      if (s.owner === token) s.worker.postMessage({ kind: 'release', id: s.nextId++ } satisfies WorkerRequest)
    },  }
}
