import { useEffect, useRef, useState } from 'react'
import { createExtractor, type Backend, type Extractor } from '../src/index'
import { decodeFile, encodeWav } from './audio'
import { hasWebGpu, loadModels, MODELS } from './models'
import type { Settings } from './settings'

export type ItemStatus = 'waiting' | 'running' | 'done' | 'error'

/** 一覧の1曲 */
export interface QueueItem {
  id: number
  file: File
  status: ItemStatus
  /** 取り出し中の進み具合（0〜1） */
  progress: number
  /** 取り出した音（設定で選んだものだけ） */
  vocals?: Blob
  accompaniment?: Blob
  error?: string
}

/** 一覧全体の段階（モデルの取得・準備は全曲で1回） */
export type Phase = { kind: 'model'; progress: number } | { kind: 'init' } | { kind: 'separate' } | null

let nextId = 1

/**
 * 複数の曲を1曲ずつ順に取り出す。モデルは最初に1回読み込み、一覧が終わるまで使い回す。
 * 終わったら Worker ごと解放する（推論中は数百MB使うため、持ち続けない）
 */
export function useQueue(settings: Settings) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [phase, setPhase] = useState<Phase>(null)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const abortRef = useRef<AbortController | null>(null)
  const [running, setRunning] = useState(false)

  // 画面を離れるときは処理を止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const patch = (id: number, p: Partial<QueueItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const add = (files: File[]) =>
    setItems((list) => [...list, ...files.map((file): QueueItem => ({ id: nextId++, file, status: 'waiting', progress: 0 }))])
  const remove = (id: number) => setItems((list) => list.filter((it) => it.id !== id))
  const clear = () => setItems((list) => list.filter((it) => it.status === 'running'))
  const retry = (id: number) => patch(id, { status: 'waiting', progress: 0, error: undefined, vocals: undefined, accompaniment: undefined })

  /** モデルを読み込んで Extractor を作る（WebGPU で作れなければ CPU で作り直す） */
  const create = async (signal: AbortSignal): Promise<Extractor> => {
    setPhase({ kind: 'model', progress: 0 })
    const models = await loadModels(settings.model, (p) => setPhase({ kind: 'model', progress: p }), signal)
    setPhase({ kind: 'init' })
    const useGpu = settings.gpu && MODELS[settings.model].webgpu && (await hasWebGpu())
    // モデルは Worker に移されるので、作り直すときのために複製を渡す
    const make = (backend: Backend) => createExtractor({ vocals: models.vocals.slice(0), accompaniment: models.accompaniment.slice(0), backend })
    return useGpu ? make('webgpu').catch(() => make('wasm')) : make('wasm')
  }

  /** 待機中の曲をすべて、上から順に取り出す */
  const runAll = async () => {
    if (abortRef.current || !itemsRef.current.some((it) => it.status === 'waiting')) return
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
        const item = itemsRef.current.find((it) => it.status === 'waiting')
        if (!item || ac.signal.aborted) break
        patch(item.id, { status: 'running', progress: 0 })
        try {
          const clip = await decodeFile(item.file)
          const onProgress = (p: number) => patch(item.id, { progress: p })
          const wav = (channels: Float32Array[]) => encodeWav({ sampleRate: clip.sampleRate, channels })
          if (settings.stems === 'both') {
            const r = await ex.separateBoth(clip.channels, clip.sampleRate, { highBand, onProgress })
            patch(item.id, { status: 'done', vocals: wav(r.vocals), accompaniment: wav(r.accompaniment) })
          } else {
            const r = await ex.separate(clip.channels, clip.sampleRate, { stem: settings.stems, highBand, onProgress })
            patch(item.id, { status: 'done', [settings.stems]: wav(r) })
          }
        } catch (e) {
          // 中止したときは待機中に戻す（もう一度「すべて取り出す」で続きから）
          if (ac.signal.aborted) patch(item.id, { status: 'waiting', progress: 0 })
          else patch(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
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

  return { items, phase, error, running, add, remove, clear, retry, runAll, cancel }
}
