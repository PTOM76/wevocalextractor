/** 推論の実行方法 */
export type Backend = 'wasm' | 'webgpu'
/** 読み込む ONNX Runtime（gpu: WebGPU 対応版。CPU でも動く / cpu: WASM 版。CPU だけ） */
export type Runtime = 'gpu' | 'cpu'
/** 取り出す音。Demucs は楽器ごとにも分ける（accompaniment はボーカル以外の和） */
export type Stem = 'vocals' | 'accompaniment' | DemucsSource
/** Demucs が出す音 */
export type DemucsSource = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano'
/** モデルが扱わない約 11kHz より上の扱い（zeros: 消す / edge: 1024 ビン目のマスクで延ばす） */
export type HighBand = 'zeros' | 'edge'

/** UVR の MDX-Net のモデルごとの値（ONNX のメタデータと UVR の設定。docs/MODELS.md） */
export interface MdxParams {
  nFft: number
  dimF: number
  dimT: number
  hop: number
  /** 取り出した音に掛ける補正（UVR の compensate） */
  compensate: number
  /** モデルが取り出す音。もう一方は元の音から引いて求める */
  primary: Stem
}

/** Demucs（htdemucs）のモデルごとの値（docs/MODELS.md の「Demucs」） */
export interface DemucsParams {
  /** モデルが出す音の順 */
  sources: readonly DemucsSource[]
}

/** 推論に使うモデル。Spleeter はボーカル用と伴奏用の 2 つ、MDX-Net と Demucs は 1 つ */
export type ModelData =
  | { kind: 'spleeter'; vocals: ArrayBuffer; accompaniment: ArrayBuffer }
  | { kind: 'mdx'; model: ArrayBuffer; params: MdxParams }
  | { kind: 'demucs'; model: ArrayBuffer; params: DemucsParams }

/** `askFallback` のとき、GPU で処理できなかったら、このエラー（後ろに理由）で知らせる */
export const GPU_FALLBACK = 'GPU_FALLBACK:'

export type WorkerRequest =
  /** `memoryMb` は ONNX Runtime の wasm のメモリの上限、`runtime` は読み込む版、`wasmUrl` はその wasm の場所（省くと同じ場所）。どれも最初の init のときだけ効く */
  | { kind: 'init'; id: number; model: ModelData; backend: Backend; memoryMb: number; runtime: Runtime; wasmUrl?: string; askFallback?: boolean }
  /** `stems` の順に、それぞれの音（ステレオ）を返す。推論は1回で済む */
  | { kind: 'separate'; id: number; channels: Float32Array[]; stems: Stem[]; highBand: HighBand }
  /** GPU で処理できなかったあと、CPU で作り直す（`askFallback` のとき。呼び出し側が確かめてから送る） */
  | { kind: 'useCpu'; id: number }
  /** セッションを手放す（Worker は残して、次の init で使い回す） */
  | { kind: 'release'; id: number }

export type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; progress: number }
  | { id: number; stems: Float32Array[][] }
  | { id: number; error: string }
  /** WebGPU のデバイスが失われた（要求とは関係なく送る。`message` は理由） */
  | { id: 0; deviceLost: string }
