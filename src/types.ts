/** 推論の実行方法 */
export type Backend = 'wasm' | 'webgpu'
/** 読み込む ONNX Runtime（gpu: WebGPU 対応版。CPU でも動く / cpu: WASM 版。CPU だけ） */
export type Runtime = 'gpu' | 'cpu'
/** 取り出す音 */
export type Stem = 'vocals' | 'accompaniment'
/** モデルが扱わない約 11kHz より上の扱い（zeros: 消す / edge: 1024 ビン目のマスクで延ばす） */
export type HighBand = 'zeros' | 'edge'

export type WorkerRequest =
  /** `memoryMb` は ONNX Runtime の wasm のメモリの上限、`runtime` は読み込む版、`wasmUrl` はその wasm の場所（省くと同じ場所）。どれも最初の init のときだけ効く */
  | { kind: 'init'; id: number; vocals: ArrayBuffer; accompaniment: ArrayBuffer; backend: Backend; memoryMb: number; runtime: Runtime; wasmUrl?: string }
  /** `stems` の順に、それぞれの音（ステレオ）を返す。推論は1回で済む */
  | { kind: 'separate'; id: number; channels: Float32Array[]; stems: Stem[]; highBand: HighBand }
  /** セッションを手放す（Worker は残して、次の init で使い回す） */
  | { kind: 'release'; id: number }

export type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; progress: number }
  | { id: number; stems: Float32Array[][] }
  | { id: number; error: string }
