import type { Stem } from '../src/index'

/** モデルの種類（docs/MODELS.md）。ファイルは scripts/fetch-models.mjs が public/models/<種類>/ に置く */
export type ModelKind = 'fp16' | 'int8' | 'fp32'

export const MODELS: Record<ModelKind, { mb: number; webgpu: boolean }> = {
  fp16: { mb: 38, webgpu: false },
  int8: { mb: 50, webgpu: true },
  fp32: { mb: 75, webgpu: true },
}

/** 取得したモデルの保存先。2回目からはダウンロードせずに使う */
const CACHE = 'wevocalextractor-models'

const modelUrl = (kind: ModelKind, stem: Stem) => new URL(`${import.meta.env.BASE_URL}models/${kind}/${stem}.onnx`, location.href).href

/** Cache Storage が使えるか（https か localhost だけ） */
const cacheSupported = () => typeof caches !== 'undefined'

/** `url` を取得する。`onProgress` に受け取ったバイト数を渡す */
async function download(url: string, onBytes: (n: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const cache = cacheSupported() ? await caches.open(CACHE) : null
  const hit = await cache?.match(url)
  if (hit) {
    const buf = await hit.arrayBuffer()
    onBytes(buf.byteLength)
    return buf
  }
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  const parts: Uint8Array[] = []
  const reader = res.body.getReader()
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    parts.push(r.value)
    onBytes(r.value.length)
  }
  const buf = await new Blob(parts as BlobPart[]).arrayBuffer()
  // 保存できなくても（容量不足など）、今回はそのまま使う
  await cache?.put(url, new Response(buf.slice(0))).catch(() => {})
  return buf
}

/** ボーカル用・伴奏用のモデルを取得する。`onProgress` は 0〜1 */
export async function loadModels(kind: ModelKind, onProgress: (p: number) => void, signal: AbortSignal) {
  const total = MODELS[kind].mb * 2 ** 20
  let done = 0
  const onBytes = (n: number) => onProgress(Math.min(1, (done += n) / total))
  const [vocals, accompaniment] = await Promise.all([
    download(modelUrl(kind, 'vocals'), onBytes, signal),
    download(modelUrl(kind, 'accompaniment'), onBytes, signal),
  ])
  return { vocals, accompaniment }
}

/** 保存済みのモデルを消す */
export async function clearModels() {
  if (cacheSupported()) await caches.delete(CACHE)
}

/** WebGPU が使えるか（アダプターが取れるか） */
export async function hasWebGpu() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  try {
    return !!(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}
