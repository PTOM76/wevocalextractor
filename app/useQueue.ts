import { useEffect, useState } from 'react'
import { useJobQueue, type JobItem } from 'pevenmui'
import { createExtractor, type Backend, type Extractor } from '../src/index'
import { EXPORT_EXT, MP3_SAMPLE_RATES, OPUS_SAMPLE_RATE, decodeFile, exportAudio, type Clip } from 'wevocal-lib'
import { hasWebGpu, loadModels, loadRuntime, resolveModel } from './models'
import { backendAllowed } from '../src/compat'
import type { Settings } from './settings'
import { t } from './i18n'
import { clearQueue, loadQueue, putItem, signature, toStored } from './persist'

/** 一覧の1曲 */
export interface QueueItem extends JobItem {
  /** 抽出した音（設定で選んだものだけ） */
  vocals?: Blob
  accompaniment?: Blob
  /** ダウンロードした結果（次に開いたときには残さない。画面の一覧からは消さない） */
  saved?: { vocals?: boolean; accompaniment?: boolean }
}

/** 一覧全体の段階（モデルの取得・準備は全曲で1回） */
export type Phase = { kind: 'model'; progress: number } | { kind: 'init' } | { kind: 'separate' } | null

/** 書き出すサンプルレート。WAV は元のまま、MP3 は扱える中で一番近いもの、Opus は 48kHz */
function outputRate(format: Settings['format'], rate: number) {
  if (format === 'opus') return OPUS_SAMPLE_RATE
  if (format === 'mp3') return MP3_SAMPLE_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a))
  return rate
}

/**
 * 複数の曲を1曲ずつ順に抽出する（一覧の操作と保存は PevenMUI の useJobQueue）。モデルは最初に1回読み込み、一覧が終わるまで使い回す。
 * 終わったら Worker ごと解放する（推論中は数百MB使うため、持ち続けない）。
 * `confirmCpu` は、GPU で処理できなかったときに CPU で続けるかを尋ねる（`reason` は理由。偽なら中断）。
 * `onGpuLost` は、WebGPU のデバイスが失われたときに呼ぶ（ブラウザの再起動を勧める）
 */
export function useQueue(settings: Settings, confirmCpu: (reason: string) => Promise<boolean>, onGpuLost: (message: string) => void) {
  const [phase, setPhase] = useState<Phase>(null)

  /** モデルを読み込んで Extractor を作る（WebGPU で作れなければ CPU で作り直す） */
  const create = async (signal: AbortSignal): Promise<Extractor> => {
    setPhase({ kind: 'model', progress: 0 })
    // この端末と非互換のモデルなら、代わりのモデルで抽出する（src/compat.ts。設定は変えない）
    const model = resolveModel(settings.model, settings.gpu).model
    const models = await loadModels(model, (p) => setPhase({ kind: 'model', progress: p }), signal)
    setPhase({ kind: 'init' })
    const useGpu = settings.gpu && backendAllowed(model, 'webgpu') && (await hasWebGpu())
    // モデルは Worker に移されるので、作り直すときのために複製を渡す
    // ONNX Runtime の wasm は使う方だけを取得する（Worker が読み込み終えたら手放す）
    const make = async (backend: Backend) => {
      const runtime = await loadRuntime(backend, signal)
      try {
        return await createExtractor({ ...models.options(), backend, memoryMb: settings.memoryMb, wasmUrl: runtime.wasmUrl, onGpuFallback: backend === 'webgpu' ? confirmCpu : undefined, onGpuDeviceLost: onGpuLost })
      } finally {
        runtime.release()
      }
    }
    // GPU を使う設定で、ブラウザに WebGPU があるのに使えない（アダプターが取れない）ときも、黙って CPU にしない
    if (!useGpu && settings.gpu && 'gpu' in navigator && backendAllowed(model, 'webgpu') && !(await confirmCpu(t('error.noAdapter'))))
      throw new DOMException('cancelled', 'AbortError')
    if (!useGpu) return make('wasm')
    // WebGPU で作れなければ、確かめてから CPU で作り直す
    return make('webgpu').catch(async (e: unknown) => {
      if (!(await confirmCpu(String(e)))) throw new DOMException('cancelled', 'AbortError')
      return make('wasm')
    })
  }

  const q = useJobQueue<QueueItem, ReturnType<typeof toStored>, Extractor>({
    open: async (signal) => {
      const ex = await create(signal)
      setPhase({ kind: 'separate' })
      return ex
    },
    // その曲だけ中止したときも、実行環境を止めて抽出を止める（次の曲の前に作り直す）
    close: (ex) => ex.dispose(),
    process: async (item, { onProgress, resource: ex }) => {
      const highBand = settings.highBand ? 'edge' : 'zeros'
      const clip = await decodeFile(item.file)
      const encode = (channels: Float32Array[]) => {
        const c: Clip = { sampleRate: clip.sampleRate, channels }
        return exportAudio(c, { format: settings.format, wavFormat: settings.wavFormat, kbps: settings.kbps, sampleRate: outputRate(settings.format, clip.sampleRate), mono: false, range: null })
      }
      const ext = EXPORT_EXT[settings.format]
      if (settings.stems === 'both') {
        const r = await ex.separateBoth(clip.channels, clip.sampleRate, { highBand, onProgress })
        return { ext, vocals: await encode(r.vocals), accompaniment: await encode(r.accompaniment) }
      }
      const r = await ex.separate(clip.channels, clip.sampleRate, { stem: settings.stems, highBand, onProgress })
      return { ext, [settings.stems]: await encode(r) }
    },
    persist: {
      // 起動時の設定で1回だけ決める
      enabled: settings.keepQueue !== 'none',
      mode: settings.keepQueue,
      load: loadQueue,
      clear: clearQueue,
      toStored: (it) => toStored(it, settings.keepQueue),
      signature,
      put: putItem,
    },
  })
  // 一覧の処理が終わったら段階の表示を消す
  useEffect(() => {
    if (!q.running) setPhase(null)
  }, [q.running])

  /** 結果をダウンロードしたことを覚える（次に開いたときには残さない） */
  const markSaved = (id: number, stems: ('vocals' | 'accompaniment')[]) =>
    q.patch(id, (it) => ({ saved: { ...it.saved, ...Object.fromEntries(stems.map((s) => [s, true])) } }))

  return { items: q.items, phase, error: q.error, running: q.running, add: q.add, remove: q.remove, clear: q.clear, run: q.run, cancel: q.cancel, cancelItem: q.cancelItem, markSaved }
}
