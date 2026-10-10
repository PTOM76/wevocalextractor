/**
 * Extractor を追加機能として使うアプリ（WeVocalSynth、WeVocal Studio）のための手順。モデルの表、計算の種類（WebGPU か CPU）の選び方、
 * 追加機能からのモデルと実行環境の読み込み、ボーカルと伴奏、主旋律とハモリ、楽器ごとに分ける手順。
 * アプリの編集（範囲に貼り直す、トラックに置く）には依存しない。追加機能の読み込み方とメモリの解放はアプリから渡す（`createHost`）
 */
import { backendAllowed, effectiveModel } from './compat'
import { DEMUCS_MODELS, type DemucsModelId } from './demucsModels'
import { MDX_MODELS, type MdxModelId } from './mdxModels'
import type * as ExtractorModule from './index'
import type { Backend, DemucsSource, Runtime, Stem } from './types'

/** ボーカルと伴奏に分けるモデル（追加機能の ID と、MDX-Net なら番号。lead は主旋律とハモリを分けるモデル） */
export const VOCAL_MODELS = {
  fp16: { addon: 'spleeter-fp16' },
  int8: { addon: 'spleeter-int8' },
  fp32: { addon: 'spleeter-fp32' },
  'voc-ft': { addon: 'uvr-mdx-voc-ft', mdx: 'voc-ft' },
  'inst-hq4': { addon: 'uvr-mdx-inst-hq4', mdx: 'inst-hq4' },
  // 主旋律とハモリを分ける（`splitLead` で、取り出したボーカルに掛ける）。抽出のモデルとしては選べない
  kara2: { addon: 'uvr-mdx-kara2', mdx: 'kara2', lead: true },
} as const satisfies Record<string, { addon: string; mdx?: MdxModelId; lead?: true }>
export type VocalModel = keyof typeof VOCAL_MODELS

/** 楽器ごとに分けるモデル（Demucs） */
export const STEM_MODELS = {
  htdemucs: { addon: 'demucs-4', demucs: 'htdemucs' },
  htdemucs6s: { addon: 'demucs-6', demucs: 'htdemucs6s' },
} as const satisfies Record<string, { addon: string; demucs: DemucsModelId }>
export type StemModel = keyof typeof STEM_MODELS

/** 主旋律とハモリを分けるモデル */
export const LEAD_MODEL: VocalModel = 'kara2'

/** 抽出のモデルとして選べるもの（主旋律モデルは除く） */
export const EXTRACT_MODELS = (Object.keys(VOCAL_MODELS) as VocalModel[]).filter((m) => !('lead' in VOCAL_MODELS[m]))

/** UVR の MDX-Net か（CPU では曲の長さの約 10 倍かかる。docs/MODELS.md） */
export const isMdxModel = (model: VocalModel) => 'mdx' in VOCAL_MODELS[model]

/** この端末で実際に使うモデル（非互換なら代わりのもの）と、替えたか */
export function resolveModel(model: VocalModel, gpu: boolean): { model: VocalModel; replaced: boolean } {
  const r = effectiveModel(model, { gpu }, Object.keys(VOCAL_MODELS))
  return { model: r.model as VocalModel, replaced: r.reason !== null }
}

/** 抽出の設定 */
export interface ExtractOptions {
  model: VocalModel
  /** 楽器ごとに分けるときのモデル（あれば `model` の代わりに使う） */
  stemModel?: StemModel
  /** GPU（WebGPU）を使ってよいか */
  gpu: boolean
  /** 約 11kHz より上を残す（モデルが扱わない帯域） */
  keepHighBand: boolean
  /** 実行環境の wasm のメモリの上限（MB。なければ既定） */
  memoryMb?: number
  /** CPU で使うスレッドの数（0 は自動） */
  threads?: number
  /** 計算の種類（`planBackend` で決めたもの。なければ抽出のときに決める） */
  backend?: Backend
}

/** ONNX Runtime の wasm の追加機能（WebGPU 対応版 / WASM 版。要る方だけを入れる） */
export const RUNTIME_ADDONS: Record<Runtime, string> = { gpu: 'vocal-extractor-gpu', cpu: 'vocal-extractor-cpu' }

/** メモリ不足で失敗したか（iOS は RangeError: out of memory か、実行環境を作れず no available backend found になる） */
export const isOutOfMemory = (e: unknown) => /out of memory|no available backend/i.test(String(e))

/** GPU で処理できなかったときに、CPU で続けるかを尋ねる（`reason` は理由。偽なら中断） */
export type ConfirmCpu = (reason: string) => Promise<boolean>

/** WebGPU が使えるか（アダプターが取れるか） */
async function hasWebGpu() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  try {
    return !!(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}

const runtimeOf = (backend: Backend): Runtime => (backend === 'webgpu' ? 'gpu' : 'cpu')

/** 計算の種類と、それに要る実行環境の追加機能（抽出の前に、導入済みか確かめるため） */
export async function planBackend(o: ExtractOptions): Promise<{ backend: Backend; runtimeAddon: string }> {
  const backend = o.gpu && backendAllowed(o.stemModel ?? o.model, 'webgpu') && (await hasWebGpu()) ? 'webgpu' : 'wasm'
  return { backend, runtimeAddon: RUNTIME_ADDONS[runtimeOf(backend)] }
}

/** アプリから渡す、追加機能の読み込み方とメモリの解放（保存先はアプリごとに違う。PevenMUI の createAddons） */
export interface HostIO {
  loadAddon: <T>(id: string) => Promise<T>
  installedManifest: (id: string) => Promise<{ files: { path: string }[] } | null | undefined>
  addonFileUrl: (id: string, path: string) => string
  /** 抽出の前に呼ぶ（ほかの Worker や再生の複製を手放して、メモリを空ける） */
  beforeOpen?: () => void
  /** スマホか（抽出が終わったらすぐ Worker を止める） */
  isMobile?: () => boolean
  /** WebGPU のデバイスが失われたとき */
  onGpuLost?: (message: string) => void
}

/** 楽器ごとに分けた音（モデルが出す音ごと。`lead` と `harmony` は、ボーカルをさらに分けたとき） */
export type InstrumentStems = Partial<Record<DemucsSource | 'lead' | 'harmony', Float32Array[]>>

/** アプリの追加機能の読み込み方で、抽出の手順を作る */
export function createHost(io: HostIO) {
  async function wasmUrl(runtime: Runtime) {
    const id = RUNTIME_ADDONS[runtime]
    const file = (await io.installedManifest(id))?.files.find((f) => f.path.endsWith('.wasm'))
    if (!file) throw new Error(`${id} は導入されていません`)
    return io.addonFileUrl(id, file.path)
  }

  async function fetchModel(addon: string, file: Stem | 'model') {
    const res = await fetch(io.addonFileUrl(addon, `${file}.onnx`))
    if (!res.ok) throw new Error(`${file}.onnx: HTTP ${res.status}`)
    return res.arrayBuffer()
  }

  /** 大きいモデルは model.onnx.000、.001… に分けて置いてあるので、つなげて返す（配信先は 1 ファイル 100MB まで） */
  async function fetchJoined(addon: string) {
    const parts = (await io.installedManifest(addon))?.files.map((f) => f.path).filter((p) => /^model\.onnx\.\d+$/.test(p)).sort() ?? []
    if (!parts.length) return fetchModel(addon, 'model')
    const bufs: ArrayBuffer[] = []
    for (const p of parts) {
      const res = await fetch(io.addonFileUrl(addon, p))
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`)
      bufs.push(await res.arrayBuffer())
    }
    const out = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0))
    let at = 0
    for (const b of bufs.splice(0)) {
      out.set(new Uint8Array(b), at)
      at += b.byteLength
    }
    return out.buffer
  }

  async function open(o: ExtractOptions, backend: Backend, runtime: Runtime, keepAliveMs?: number, confirmCpu?: ConfirmCpu) {
    const info = VOCAL_MODELS[o.model] as { addon: string; mdx?: MdxModelId }
    const mod = await io.loadAddon<typeof ExtractorModule>('vocal-extractor')
    // Spleeter はボーカル用、伴奏用の 2 つ、MDX-Net と Demucs は model.onnx の 1 つ
    const stem = o.stemModel && STEM_MODELS[o.stemModel]
    const model = stem
      ? { demucs: { model: await fetchJoined(stem.addon), params: DEMUCS_MODELS[stem.demucs].params } }
      : info.mdx
        ? { mdx: { model: await fetchModel(info.addon, 'model'), params: MDX_MODELS[info.mdx].params } }
        : { vocals: await fetchModel(info.addon, 'vocals'), accompaniment: await fetchModel(info.addon, 'accompaniment') }
    return mod.createExtractor({
      ...model,
      backend,
      runtime,
      wasmUrl: await wasmUrl(runtime),
      memoryMb: o.memoryMb,
      threads: o.threads,
      keepAliveMs,
      onGpuFallback: backend === 'webgpu' ? confirmCpu : undefined,
      onGpuDeviceLost: (message) => io.onGpuLost?.(message),
    })
  }

  /** 実行環境とモデルを読み込む。先にアプリのメモリを空けてもらう。WebGPU で作れなければ、確かめてから CPU で作り直す */
  async function createExtractor(o: ExtractOptions, confirmCpu?: ConfirmCpu) {
    io.beforeOpen?.()
    const backend = o.backend ?? (await planBackend(o)).backend
    // スマホは抽出が終わったらすぐ Worker を止める（結果を置く間のメモリと重なって、iOS でタブが落ちた）
    const keep = io.isMobile?.() ? 0 : undefined
    if (backend === 'wasm') return open(o, 'wasm', 'cpu', keep)
    // WebGPU 対応版は CPU でも動くので、入っている版のまま作る
    return open(o, 'webgpu', 'gpu', keep, confirmCpu).catch(async (e: unknown) => {
      if (confirmCpu && !(await confirmCpu(String(e)))) throw new DOMException('cancelled', 'AbortError')
      return open(o, 'wasm', 'gpu', keep)
    })
  }

  let extracting = false

  /** 実行環境で `f` を行い、終わったら手放す。中断したら Worker ごと止める */
  async function withExtractor<T>(o: ExtractOptions, signal: AbortSignal | undefined, f: (ex: ExtractorModule.Extractor) => Promise<T>, confirmCpu?: ConfirmCpu) {
    extracting = true
    let extractor: ExtractorModule.Extractor
    try {
      extractor = await createExtractor(o, confirmCpu)
    } catch (e) {
      extracting = false
      throw e
    }
    const stop = () => extractor.dispose()
    signal?.addEventListener('abort', stop)
    try {
      return await f(extractor)
    } finally {
      signal?.removeEventListener('abort', stop)
      extractor.dispose()
      extracting = false
    }
  }

  /** 全体を、ボーカルと伴奏に分ける（推論は 1 回） */
  function splitBoth(channels: Float32Array[], sampleRate: number, o: ExtractOptions, onProgress: (p: number) => void, signal?: AbortSignal, confirmCpu?: ConfirmCpu) {
    return withExtractor(o, signal, (ex) => ex.separateBoth(channels, sampleRate, { highBand: o.keepHighBand ? 'edge' : 'zeros', onProgress }), confirmCpu)
  }

  /** 全体を、主旋律、ハモリ、伴奏に分ける（`o` のモデルでボーカルと伴奏に分け、そのボーカルを主旋律モデルで分ける。推論は 2 回） */
  async function splitLead(channels: Float32Array[], sampleRate: number, o: ExtractOptions, onProgress: (p: number) => void, signal?: AbortSignal, confirmCpu?: ConfirmCpu) {
    const first = await splitBoth(channels, sampleRate, o, (p) => onProgress(p / 2), signal, confirmCpu)
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    const lead: ExtractOptions = { ...o, model: LEAD_MODEL, backend: undefined }
    const second = await splitBoth(first.vocals, sampleRate, lead, (p) => onProgress(0.5 + p / 2), signal, confirmCpu)
    return { lead: second.vocals, harmony: second.accompaniment, accompaniment: first.accompaniment }
  }

  /** 全体を、`o.stemModel` のモデル（Demucs）で楽器ごとに分ける。`chorus` なら、ボーカルをさらに主旋律とハモリに分ける */
  async function splitInstruments(channels: Float32Array[], sampleRate: number, o: ExtractOptions, chorus: boolean, onProgress: (p: number) => void, signal?: AbortSignal, confirmCpu?: ConfirmCpu): Promise<InstrumentStems> {
    if (!o.stemModel) throw new Error('stemModel is required')
    const sources = DEMUCS_MODELS[STEM_MODELS[o.stemModel].demucs].params.sources
    const share = chorus ? 0.9 : 1
    const outs = await withExtractor(o, signal, (ex) => ex.separateStems(channels, sampleRate, [...sources], { onProgress: (p) => onProgress(p * share) }), confirmCpu)
    const r: InstrumentStems = Object.fromEntries(sources.map((s, i) => [s, outs[i]]))
    if (!chorus || !r.vocals) return r
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    const lead: ExtractOptions = { ...o, model: LEAD_MODEL, stemModel: undefined, backend: undefined }
    const second = await splitBoth(r.vocals, sampleRate, lead, (p) => onProgress(share + p * (1 - share)), signal, confirmCpu)
    return { ...r, vocals: undefined, lead: second.vocals, harmony: second.accompaniment }
  }

  return {
    withExtractor,
    splitBoth,
    splitLead,
    splitInstruments,
    /** 診断用: 計算の種類を決めて実行環境を作る。メモリを手放さず、CPU への切り替えもしない */
    openExtractor: (o: ExtractOptions, backend: Backend) => open(o, backend, runtimeOf(backend)),
    /** 抽出中か */
    isExtracting: () => extracting,
  }
}

/**
 * 追加機能の一覧（実行環境とモデル。PevenMUI の AddonInfo の形）。名前は訳文のキーで、アプリの訳文に同じキーを置く。
 * 実行環境の wasm は、WebGPU で動かすなら gpu、CPU なら cpu を入れる（planBackend）
 */
export const EXTRACTOR_ADDONS = [
  { id: 'vocal-extractor', name: 'addon.vocalExtractor' },
  { id: 'vocal-extractor-gpu', name: 'addon.runtimeGpu', requires: ['vocal-extractor'], companion: true },
  { id: 'vocal-extractor-cpu', name: 'addon.runtimeCpu', requires: ['vocal-extractor'], companion: true },
  { id: 'spleeter-fp16', name: 'addon.spleeterFp16', shortName: 'addon.modelLight', requires: ['vocal-extractor'] },
  { id: 'spleeter-int8', name: 'addon.spleeterInt8', shortName: 'addon.modelStandard', requires: ['vocal-extractor'] },
  { id: 'spleeter-fp32', name: 'addon.spleeterFp32', shortName: 'addon.modelPrecise', requires: ['vocal-extractor'] },
  { id: 'uvr-mdx-voc-ft', name: 'addon.uvrVocFt', shortName: 'addon.modelVocalHq', requires: ['vocal-extractor'] },
  { id: 'uvr-mdx-inst-hq4', name: 'addon.uvrInstHq4', shortName: 'addon.modelInstHq', requires: ['vocal-extractor'] },
  { id: 'uvr-mdx-kara2', name: 'addon.uvrKara2', shortName: 'addon.modelLead', requires: ['vocal-extractor'] },
  // 楽器ごとに分ける（Demucs。モデルは 100MB を超えるので、分けて置いてある）
  { id: 'demucs-4', name: 'addon.demucs4', shortName: 'addon.modelStems4', requires: ['vocal-extractor'] },
  { id: 'demucs-6', name: 'addon.demucs6', shortName: 'addon.modelStems6', requires: ['vocal-extractor'] },
] as const

/**
 * 計算の種類を決め、`addon`（モデル）とそれに要る実行環境を導入済みにしてから、抽出の設定を返す。やめたら null。
 * GPU を使う設定で、ブラウザに WebGPU があるのに使えない（アダプターが取れない）ときは、黙って CPU にせず `confirmCpu` で尋ねる
 */
export async function prepareExtract(
  o: ExtractOptions,
  addon: string,
  ui: { ensure: (id: string, also?: string[]) => Promise<boolean>; confirmCpu: ConfirmCpu; noAdapter: string },
): Promise<ExtractOptions | null> {
  const plan = await planBackend(o)
  if (o.gpu && plan.backend === 'wasm' && 'gpu' in navigator && backendAllowed(o.stemModel ?? o.model, 'webgpu') && !(await ui.confirmCpu(ui.noAdapter))) return null
  if (!(await ui.ensure(addon, [plan.runtimeAddon]))) return null
  return { ...o, backend: plan.backend }
}

/** 楽器ごとに分けた音の並びと、トラックの名前の訳文のキー（{name} に元の名前が入る。モデルが出さない音は作らない） */
export const STEM_ORDER = [
  ['vocals', 'track.vocalsName'],
  ['lead', 'track.leadName'],
  ['harmony', 'track.harmonyName'],
  ['drums', 'track.drumsName'],
  ['bass', 'track.bassName'],
  ['guitar', 'track.guitarName'],
  ['piano', 'track.pianoName'],
  ['other', 'track.otherName'],
] as const satisfies readonly (readonly [keyof InstrumentStems, string])[]
