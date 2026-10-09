// CPU（wasm）で使うスレッドの数の決め方（推論の Worker と診断で使う）

/**
 * CPU（wasm）で使うスレッドの数。cross-origin isolation でなければ（SharedArrayBuffer が無ければ）1。
 * 0（自動）は 4 と（コアの数 − 1）の小さい方で、iOS は 1（共有メモリの枠が少ない。docs/DECISIONS.md）
 */
export function resolveThreads(threads = 0): number {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) return 1
  if (threads > 0) return threads
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  return ios ? 1 : Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 1) - 1))
}
