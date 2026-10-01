/**
 * WeVocalExtractor: 曲からボーカル（または伴奏）を取り出す。UI を持たず、React にも依存しない（docs/EXTRACTOR.md）。
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

export async function createExtractor(opts: ExtractorOptions): Promise<Extractor> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>()
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    if ('progress' in e.data) return p.onProgress?.(e.data.progress)
    pending.delete(e.data.id)
    if ('error' in e.data) p.reject(new Error(e.data.error))
    else p.resolve(e.data)
  }
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || 'extractor worker error')))
    pending.clear()
  }
  const send = (req: WorkerRequest, transfer: Transferable[], onProgress?: (p: number) => void) =>
    new Promise<WorkerResponse>((resolve, reject) => {
      pending.set(req.id, { resolve, reject, onProgress })
      worker.postMessage(req, transfer)
    })

  try {
    // モデルは Worker に移すので、呼び出し元の ArrayBuffer は使えなくなる
    await send({ kind: 'init', id: nextId++, vocals: opts.vocals, accompaniment: opts.accompaniment, backend: opts.backend }, [
      opts.vocals,
      opts.accompaniment,
    ])
  } catch (e) {
    worker.terminate()
    throw e
  }

  return {
    async separate(channels, sampleRate, o) {
      const n = channels[0].length
      const input = await convert(channels, sampleRate, MODEL_RATE, 2)
      // 変換しなかった場合は呼び出し元の配列なので、コピーしてから Worker に移す
      const owned = input === channels ? input.map((c) => c.slice()) : input
      const res = await send(
        { kind: 'separate', id: nextId++, channels: owned, stem: o.stem, highBand: o.highBand ?? 'zeros' },
        owned.map((c) => c.buffer),
        o.onProgress,
      )
      if (!('channels' in res)) throw new Error('unexpected response')
      const back = await convert(res.channels, MODEL_RATE, sampleRate, channels.length)
      // サンプルレートの変換で 1 サンプル程度ずれることがあるので、入力と同じ長さにそろえる
      return back.map((c) => {
        if (c.length === n) return c
        const o2 = new Float32Array(n)
        o2.set(c.subarray(0, n))
        return o2
      })
    },
    dispose() {
      worker.terminate()
      // 処理中の separate は待ち続けないよう失敗させる（中断に使える）
      pending.forEach((p) => p.reject(new DOMException('disposed', 'AbortError')))
      pending.clear()
    },
  }
}
