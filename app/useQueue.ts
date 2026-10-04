import { useEffect, useRef, useState } from 'react'
import { createExtractor, type Backend, type Extractor } from '../src/index'
import { EXPORT_EXT, MP3_SAMPLE_RATES, OPUS_SAMPLE_RATE, decodeFile, exportAudio, type Clip } from 'wevocal-lib'
import { hasWebGpu, loadModels, resolveModel } from './models'
import { backendAllowed } from '../src/compat'
import type { Settings } from './settings'
import { t } from './i18n'
import { clearQueue, loadQueue, putItem, signature, toStored } from './persist'

/** `cancelled` はその曲だけ中止したもの（保存するときは待機中として残す） */
export type ItemStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled'

/** 一覧の1曲 */
export interface QueueItem {
  id: number
  file: File
  status: ItemStatus
  /** 抽出中の進み具合（0〜1） */
  progress: number
  /** 抽出した音（設定で選んだものだけ） */
  vocals?: Blob
  accompaniment?: Blob
  /** 書き出した形式の拡張子（.wav など） */
  ext?: string
  error?: string
  /** ダウンロードした結果（次に開いたときには残さない。画面の一覧からは消さない） */
  saved?: { vocals?: boolean; accompaniment?: boolean }
}

/** 一覧全体の段階（モデルの取得・準備は全曲で1回） */
export type Phase = { kind: 'model'; progress: number } | { kind: 'init' } | { kind: 'separate' } | null

let nextId = 1

/** 書き出すサンプルレート。WAV は元のまま、MP3 は扱える中で一番近いもの、Opus は 48kHz */
function outputRate(format: Settings['format'], rate: number) {
  if (format === 'opus') return OPUS_SAMPLE_RATE
  if (format === 'mp3') return MP3_SAMPLE_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a))
  return rate
}

/**
 * 複数の曲を1曲ずつ順に抽出する。モデルは最初に1回読み込み、一覧が終わるまで使い回す。
 * 終わったら Worker ごと解放する（推論中は数百MB使うため、持ち続けない）
 */
/**
 * `confirmCpu` は、GPU で処理できなかったときに CPU で続けるかを尋ねる（`reason` は理由。偽なら中断）。
 * `onGpuLost` は、WebGPU のデバイスが失われたときに呼ぶ（ブラウザの再起動を勧める）
 */
export function useQueue(settings: Settings, confirmCpu: (reason: string) => Promise<boolean>, onGpuLost: (message: string) => void) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [phase, setPhase] = useState<Phase>(null)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const abortRef = useRef<AbortController | null>(null)
  /** 抽出中の曲と、その曲だけを止める関数（`cancelItem`） */
  const currentRef = useRef<{ id: number; stop: () => void } | null>(null)
  const [running, setRunning] = useState(false)

  // 画面を離れるときは処理を止める
  useEffect(() => () => abortRef.current?.abort(), [])

  // 曲ごとに、最後に書き込んだ内容（`signature`）
  const written = useRef(new Map<number, string>())
  // 前回の一覧を戻す（読み終わる前に足された曲は後ろに並べる）。読み終わるまでは書き込まない
  const [restored, setRestored] = useState(false)
  // 戻すのは 1 回だけ（開発中の StrictMode は 2 回呼ぶ。2 回足すと同じ曲が 2 つ並んだ）
  const restoringRef = useRef(false)
  useEffect(() => {
    if (restoringRef.current) return
    restoringRef.current = true
    // 残さない設定なら戻さず、前に残したものも消す
    if (settings.keepQueue === 'none') {
      void clearQueue().then(() => setRestored(true))
      return
    }
    void loadQueue().then((saved) => {
      nextId = Math.max(nextId, ...saved.map((it) => it.id + 1))
      saved.forEach((it) => written.current.set(it.id, signature(toStored(it, 'all'))))
      // すでに一覧にある曲は足さない
      setItems((list) => [...saved.filter((s) => !list.some((it) => it.id === s.id)), ...list])
      setRestored(true)
    })
    // 起動時の設定で1回だけ決める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 一覧が変わったら、変わった曲だけ書き込む（抽出中の進み具合だけの変化では書かない）。一覧から消えた曲は消す
  useEffect(() => {
    if (!restored) return
    const ids = new Set(items.map((it) => it.id))
    for (const it of items) {
      const s = toStored(it, settings.keepQueue)
      const sig = signature(s)
      if (written.current.get(it.id) === sig) continue
      written.current.set(it.id, sig)
      void putItem(it.id, s)
    }
    // Map は回している途中で消してもよい
    for (const id of written.current.keys()) {
      if (ids.has(id)) continue
      written.current.delete(id)
      void putItem(id, null)
    }
  }, [items, restored, settings.keepQueue])

  const patch = (id: number, p: Partial<QueueItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  /** 結果をダウンロードしたことを覚える（次に開いたときには残さない） */
  const markSaved = (id: number, stems: ('vocals' | 'accompaniment')[]) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, saved: { ...it.saved, ...Object.fromEntries(stems.map((s) => [s, true])) } } : it)))

  const add = (files: File[]) =>
    setItems((list) => [...list, ...files.map((file): QueueItem => ({ id: nextId++, file, status: 'waiting', progress: 0 }))])
  const remove = (id: number) => setItems((list) => list.filter((it) => it.id !== id))
  const clear = () => setItems((list) => list.filter((it) => it.status === 'running'))

  /** モデルを読み込んで Extractor を作る（WebGPU で作れなければ CPU で作り直す） */
  const create = async (signal: AbortSignal): Promise<Extractor> => {
    setPhase({ kind: 'model', progress: 0 })
    // この端末と非互換のモデルなら、代わりのモデルで抽出する（src/compat.ts。設定は変えない）
    const model = resolveModel(settings.model, settings.gpu).model
    const models = await loadModels(model, (p) => setPhase({ kind: 'model', progress: p }), signal)
    setPhase({ kind: 'init' })
    const useGpu = settings.gpu && backendAllowed(model, 'webgpu') && (await hasWebGpu())
    // モデルは Worker に移されるので、作り直すときのために複製を渡す
    const make = (backend: Backend) =>
      createExtractor({ ...models.options(), backend, memoryMb: settings.memoryMb, onGpuFallback: backend === 'webgpu' ? confirmCpu : undefined, onGpuDeviceLost: onGpuLost })
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

  /** 待機中の曲を上から順に抽出する。`only` を渡すとその曲だけ（失敗した曲のやり直しにも使う） */
  const run = async (only?: number) => {
    if (abortRef.current) return
    if (only === undefined && !itemsRef.current.some((it) => it.status === 'waiting')) return
    // その曲だけのときは、状態によらず1回だけ抽出する
    let onlyLeft = only !== undefined
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setError(null)
    let ex: Extractor | null = null
    const stop = () => ex?.dispose()
    ac.signal.addEventListener('abort', stop)
    try {
      ex = await create(ac.signal)
      setPhase({ kind: 'separate' })
      const highBand = settings.highBand ? 'edge' : 'zeros'
      for (;;) {
        // 途中で足された曲も拾うため、毎回一覧から次を探す
        const item =
          only === undefined ? itemsRef.current.find((it) => it.status === 'waiting') : onlyLeft ? itemsRef.current.find((it) => it.id === only) : undefined
        onlyLeft = false
        if (!item || ac.signal.aborted) break
        // その曲だけ中止したあとは実行環境を止めているので、作り直す
        if (!ex) {
          ex = await create(ac.signal)
          setPhase({ kind: 'separate' })
        }
        const current = ex
        let cancelled = false
        currentRef.current = {
          id: item.id,
          stop: () => {
            cancelled = true
            current.dispose()
          },
        }
        // 抽出し直すときは、前の結果のダウンロード済みの印も消す
        patch(item.id, { status: 'running', progress: 0, error: undefined, saved: undefined })
        try {
          const clip = await decodeFile(item.file)
          const onProgress = (p: number) => patch(item.id, { progress: p })
          const encode = (channels: Float32Array[]) => {
            const c: Clip = { sampleRate: clip.sampleRate, channels }
            return exportAudio(c, { format: settings.format, wavFormat: settings.wavFormat, kbps: settings.kbps, sampleRate: outputRate(settings.format, clip.sampleRate), mono: false, range: null })
          }
          const ext = EXPORT_EXT[settings.format]
          if (settings.stems === 'both') {
            const r = await current.separateBoth(clip.channels, clip.sampleRate, { highBand, onProgress })
            patch(item.id, { status: 'done', ext, vocals: await encode(r.vocals), accompaniment: await encode(r.accompaniment) })
          } else {
            const r = await current.separate(clip.channels, clip.sampleRate, { stem: settings.stems, highBand, onProgress })
            patch(item.id, { status: 'done', ext, [settings.stems]: await encode(r) })
          }
        } catch (e) {
          // 一覧ごと中止したときは待機中に戻す（もう一度「すべて抽出する」で続きから）。その曲だけ中止したら中止にして次へ
          if (ac.signal.aborted) patch(item.id, { status: 'waiting', progress: 0 })
          else if (cancelled) {
            patch(item.id, { status: 'cancelled', progress: 0 })
            ex = null
          } else patch(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
        } finally {
          currentRef.current = null
        }
      }
    } catch (e) {
      // モデルの取得・準備で失敗した（中止したときは何も出さない）
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      ac.signal.removeEventListener('abort', stop)
      ex?.dispose()
      abortRef.current = null
      setRunning(false)
      setPhase(null)
    }
  }

  const cancel = () => abortRef.current?.abort()
  /** 曲 `id` だけを中止する。抽出中なら止めて次の曲へ、待機中なら飛ばす */
  const cancelItem = (id: number) => {
    if (currentRef.current?.id === id) currentRef.current.stop()
    else patch(id, { status: 'cancelled', progress: 0 })
  }

  return { items, phase, error, running, add, remove, clear, run, cancel, cancelItem, markSaved }
}
