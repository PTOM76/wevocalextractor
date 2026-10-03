import type { Backend } from './types'

/**
 * 端末・モデル・計算の種類の互換性。非互換と分かっている組み合わせを `RULES` に書き、
 * 抽出のときに別のモデルや計算の種類に替える。調べた結果は docs/COMPATIBILITY.md に記録し、ここの表も合わせて直す。
 * モデルは ID（文字列）で扱うので、モデルを足しても型は直さずに済む。足したら、非互換の組み合わせだけを表に足す
 */

/** 互換性に関わる端末の特徴 */
export interface Env {
  /** iPhone・iPad（iPadOS の Safari は Mac の名前を名乗るので、タッチの数でも見分ける） */
  ios: boolean
}

export function detectEnv(): Env {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return { ios }
}

/**
 * 非互換の組み合わせ。`when` を省くとすべての端末。
 * - `avoidBackend`: そのモデルではその計算の種類を使わない
 * - `use`: そのモデルを使わず、並べた順に、使えるもの（`available`）の最初に替える
 */
type Rule = { model: string; when?: (env: Env) => boolean; reason: string } & ({ avoidBackend: Backend } | { use: string[] })

const RULES: Rule[] = [
  // ONNX Runtime Web 1.30 の WebGPU で、エラーは出ずに出力がすべて 0 になった（PC・Chrome、2026-10-01）
  { model: 'fp16', avoidBackend: 'webgpu', reason: 'fp16-webgpu-zeros' },
  // WebGPU を使えないので CPU で動き、fp32 への変換の分もタブのメモリを使って、抽出のあとにタブが落ちた（iPad、2026-10-03）
  { model: 'fp16', when: (env) => env.ios, use: ['int8', 'fp32'], reason: 'ios-fp16-memory' },
]

const applies = (r: Rule, model: string, env: Env) => r.model === model && (!r.when || r.when(env))

/** `model` で `backend` を使ってよいか */
export function backendAllowed(model: string, backend: Backend, env: Env = detectEnv()) {
  return !RULES.some((r) => applies(r, model, env) && 'avoidBackend' in r && r.avoidBackend === backend)
}

/**
 * 実際に使うモデル。`model` が非互換のものなら、代わりの候補のうち `available` にある最初のもの（なければ最初の候補）。
 * 替えたときは `reason` も返す
 */
export function effectiveModel(model: string, available?: readonly string[], env: Env = detectEnv()): { model: string; reason: string | null } {
  const rule = RULES.find((r) => applies(r, model, env) && 'use' in r)
  if (!rule || !('use' in rule)) return { model, reason: null }
  const use = rule.use.find((m) => !available || available.includes(m)) ?? rule.use[0]
  return { model: use, reason: rule.reason }
}
