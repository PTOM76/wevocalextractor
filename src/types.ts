/** 推論の実行方法 */
export type Backend = 'wasm' | 'webgpu'
/** 取り出す音 */
export type Stem = 'vocals' | 'accompaniment'
/** モデルが扱わない約 11kHz より上の扱い（zeros: 消す / edge: 1024 ビン目のマスクで延ばす） */
export type HighBand = 'zeros' | 'edge'

export type WorkerRequest =
  | { kind: 'init'; id: number; vocals: ArrayBuffer; accompaniment: ArrayBuffer; backend: Backend }
  /** `stems` の順に、それぞれの音（ステレオ）を返す。推論は1回で済む */
  | { kind: 'separate'; id: number; channels: Float32Array[]; stems: Stem[]; highBand: HighBand }

export type WorkerResponse =
  | { id: number; ok: true }
  | { id: number; progress: number }
  | { id: number; stems: Float32Array[][] }
  | { id: number; error: string }
