/** 推論の実行方法 */
export type Backend = 'wasm' | 'webgpu'
/** 取り出す音 */
export type Stem = 'vocals' | 'accompaniment'
/** モデルが扱わない約 11kHz より上の扱い（zeros: 消す / edge: 1024 ビン目のマスクで延ばす） */
export type HighBand = 'zeros' | 'edge'

export type WorkerRequest =
  | { kind: 'init'; id: number; vocals: ArrayBuffer; accompaniment: ArrayBuffer; backend: Backend }
  | { kind: 'separate'; id: number; channels: Float32Array[]; stem: Stem; highBand: HighBand }

export type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; progress: number }
  | { id: number; channels: Float32Array[] }
  | { id: number; error: string }
