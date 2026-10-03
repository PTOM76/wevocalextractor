/**
 * WeVocalExtractor: 曲からボーカル（または伴奏）を取り出す。UI を持たず、React にも依存しない（docs/DESIGN.md。画面は app/）。
 * 受け渡しはチャンネルごとの Float32Array とサンプルレートだけ。推論は専用の Worker で行う。
 */
import type { Backend, HighBand, MdxParams, Runtime, Stem, WorkerRequest, WorkerResponse } from './types'

export type { Backend, HighBand, MdxParams, Runtime, Stem }

/** モデル（Spleeter 2stems）のサンプルレート */
const MODEL_RATE = 44100

export interface ExtractorOptions {
  /** Spleeter のボーカル用・伴奏用のモデル（ONNX）。`mdx` を渡すときは使わない */
  vocals?: ArrayBuffer
  accompaniment?: ArrayBuffer
  /** UVR の MDX-Net のモデル（ONNX）と、モデルごとの値（docs/MODELS.md） */
  mdx?: { model: ArrayBuffer; params: MdxParams }
  backend: Backend
  /** ONNX Runtime の wasm のメモリの上限（MB）。既定は `DEFAULT_MEMORY_MB`。変えると推論の Worker を作り直す */
  memoryMb?: number
  /** 手放してから推論の Worker を止めるまでの時間（ミリ秒）。既定は `IDLE_MS`。0 ならすぐ止めてメモリを返す（メモリの少ない端末向け） */
  keepAliveMs?: number
  /**
   * 読み込む ONNX Runtime。省くと、WebGPU なら gpu（WebGPU 対応版）、CPU なら cpu（WASM 版）。
   * gpu は CPU でも動くので、WebGPU で作れずに CPU で作り直すときは gpu のままでよい（Worker を作り直さずに済む）
   */
  runtime?: Runtime
  /** その wasm の場所（追加機能として別の場所に置くとき。省くと同じ場所） */
  wasmUrl?: string
}

/** ONNX Runtime の wasm のメモリの上限の既定（MB）。iOS は上限の分を予約の枠から差し引くので、4GB（元の値）より下げる */
export const DEFAULT_MEMORY_MB = 1024

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
type Shared = { worker: Worker; pending: Map<number, Pending>; nextId: number; owner: object | null; memoryMb: number; runtime: Runtime; idle: number }

/** 使い終わってから推論の Worker を止めるまでの時間（ミリ秒）の既定。続けて使うときは作り直さない */
export const IDLE_MS = 30_000

/**
 * 推論の Worker（ページで1つ）。手放しても `IDLE_MS` のあいだは止めずに、次の createExtractor で使い回す。
 * iOS は共有メモリ（ONNX Runtime が作る）の上限の分を予約の枠から差し引き、止めた Worker の分はすぐには返らない。
 * 使わなくなったら止めて、増えた wasm のメモリ（縮まない）を返す
 */
let shared: Shared | null = null

/** Worker を止める。処理中の要求は `reason` で失敗させる */
function drop(s: Shared, reason: Error) {
  clearTimeout(s.idle)
  s.worker.terminate()
  s.pending.forEach((p) => p.reject(reason))
  s.pending.clear()
  if (shared === s) shared = null
}

function sharedWorker(memoryMb: number, runtime: Runtime) {
  // メモリの上限と、読み込む ONNX Runtime（WebGPU 対応版か WASM 版か。worker.ts）は Worker で最初に準備したときに決まるので、変えたら作り直す。
  if (shared && (shared.memoryMb !== memoryMb || shared.runtime !== runtime)) drop(shared, new DOMException('disposed', 'AbortError'))
  if (shared) {
    clearTimeout(shared.idle)
    return shared
  }
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const s: Shared = { worker, pending: new Map(), nextId: 1, owner: null, memoryMb, runtime, idle: 0 }
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = s.pending.get(e.data.id)
    if (!p) return
    if ('progress' in e.data) return p.onProgress?.(e.data.progress)
    s.pending.delete(e.data.id)
    if ('error' in e.data) p.reject(new Error(e.data.error))
    else p.resolve(e.data)
  }
  // Worker が落ちたら、次は作り直す
  worker.onerror = (e) => drop(s, new Error(e.message || 'extractor worker error'))
  return (shared = s)
}

/** 抽出の実行環境が使われているか（作ってから手放すまで）。使われている間は、診断などで作らない */
export const extractorBusy = () => !!shared?.owner

/** 実行環境を作る。前に作ったものは使えなくなる（Worker は1つで、モデルを入れ替える） */
export async function createExtractor(opts: ExtractorOptions): Promise<Extractor> {
  const model =
    opts.mdx
      ? ({ kind: 'mdx', model: opts.mdx.model, params: opts.mdx.params } as const)
      : opts.vocals && opts.accompaniment
        ? ({ kind: 'spleeter', vocals: opts.vocals, accompaniment: opts.accompaniment } as const)
        : null
  if (!model) throw new Error('model is required')
  const memoryMb = opts.memoryMb ?? DEFAULT_MEMORY_MB
  const runtime = opts.runtime ?? (opts.backend === 'webgpu' ? 'gpu' : 'cpu')
  const s = sharedWorker(memoryMb, runtime)
  /** この実行環境が送った要求の id */
  const mine = new Set<number>()
  let disposed = false
  // Worker のモデルの持ち主。あとから作ったものに入れ替わっていたら、手放すときに Worker に触らない
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
  try {
    await send(
      { kind: 'init', id: s.nextId++, model, backend: opts.backend, memoryMb, runtime, wasmUrl: opts.wasmUrl },
      model.kind === 'mdx' ? [model.model] : [model.vocals, model.accompaniment],
    )
  } catch (e) {
    // ONNX Runtime は wasm の準備に一度失敗すると、同じ Worker では二度と準備できない
    // （previous call to initWasm() failed）。次は新しい Worker で作る
    if (s.owner === token) s.owner = null
    drop(s, new DOMException('disposed', 'AbortError'))
    throw e
  }  /** `stems` の音を、入力と同じサンプルレート・チャンネル数・長さで返す */
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
    // 1 つずつ変換する（同時に行うと、変換の途中の複製が音の数だけ重なり、iOS でタブが落ちた）
    const out: Float32Array[][] = []
    for (let i = 0; i < res.stems.length; i++) {
      const back = await convert(res.stems[i], MODEL_RATE, sampleRate, channels.length)
      // 変換前のものは、もう要らない
      res.stems[i] = []
      // サンプルレートの変換で 1 サンプル程度ずれることがあるので、入力と同じ長さにそろえる
      out.push(
        back.map((c) => {
          if (c.length === n) return c
          const o2 = new Float32Array(n)
          o2.set(c.subarray(0, n))
          return o2
        }),
      )
    }
    return out
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
      if (s.owner !== token) return
      s.owner = null
      if (mine.size) {
        // 処理中なら Worker ごと止める（すぐに止まる。処理中の separate は失敗する）
        drop(s, new DOMException('disposed', 'AbortError'))
        return
      }
      // すぐ止める設定なら止める（抽出で増えたメモリを、結果を使う処理より先に返す）
      const keep = opts.keepAliveMs ?? IDLE_MS
      if (keep <= 0) {
        drop(s, new DOMException('disposed', 'AbortError'))
        return
      }
      // セッションを手放し、しばらく使われなければ Worker を止める
      s.worker.postMessage({ kind: 'release', id: s.nextId++ } satisfies WorkerRequest)
      clearTimeout(s.idle)
      s.idle = window.setTimeout(() => !s.owner && drop(s, new DOMException('disposed', 'AbortError')), keep)
    },
  }
}
