import { useEffect, useRef, useState } from 'react'
import { createExtractor, type Backend } from '../src/index'
import { decodeFile, encodeWav, type Clip } from './audio'
import { hasWebGpu, loadModels, MODELS, type ModelKind } from './models'

/** 処理中の段階と、その進み具合（0〜1。取れない段階は undefined） */
export type Stage = { kind: 'decode' | 'model' | 'init' | 'separate'; progress?: number }

export interface Result {
  vocals: Blob
  accompaniment: Blob
}

export interface ExtractOptions {
  model: ModelKind
  gpu: boolean
  highBand: boolean
}

/**
 * ファイルからボーカルと伴奏を取り出す。推論は1回（separateBoth）。
 * モデルは毎回読み込み、終わったら Worker ごと解放する（推論中は数百MB使うため、持ち続けない）
 */
export function useExtract() {
  const [stage, setStage] = useState<Stage | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 画面を離れるときは処理を止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (file: File, o: ExtractOptions) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setResult(null)
    setError(null)
    try {
      setStage({ kind: 'decode' })
      const clip: Clip = await decodeFile(file)
      setStage({ kind: 'model', progress: 0 })
      const models = await loadModels(o.model, (p) => setStage({ kind: 'model', progress: p }), ac.signal)
      if (ac.signal.aborted) return
      setStage({ kind: 'init' })
      const useGpu = o.gpu && MODELS[o.model].webgpu && (await hasWebGpu())
      const create = (backend: Backend) =>
        // モデルは Worker に移されるので、作り直すときのために複製を渡す
        createExtractor({ vocals: models.vocals.slice(0), accompaniment: models.accompaniment.slice(0), backend })
      // WebGPU で作れなければ CPU（WASM）で作り直す
      const ex = useGpu ? await create('webgpu').catch(() => create('wasm')) : await create('wasm')
      const stop = () => ex.dispose()
      ac.signal.addEventListener('abort', stop)
      try {
        setStage({ kind: 'separate', progress: 0 })
        const r = await ex.separateBoth(clip.channels, clip.sampleRate, {
          highBand: o.highBand ? 'edge' : 'zeros',
          onProgress: (p) => setStage({ kind: 'separate', progress: p }),
        })
        if (ac.signal.aborted) return
        setResult({
          vocals: encodeWav({ sampleRate: clip.sampleRate, channels: r.vocals }),
          accompaniment: encodeWav({ sampleRate: clip.sampleRate, channels: r.accompaniment }),
        })
      } finally {
        ac.signal.removeEventListener('abort', stop)
        ex.dispose()
      }
    } catch (e) {
      // 中止したときはエラーを出さない
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null
        setStage(null)
      }
    }
  }

  const cancel = () => abortRef.current?.abort()
  const reset = () => {
    cancel()
    setResult(null)
    setError(null)
  }

  return { stage, result, error, run, cancel, reset }
}
