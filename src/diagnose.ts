/**
 * 抽出の診断（WeVocalExtractor と WeVocalSynth の設定の開発者向けで使う）。
 * iOS で実行環境を作ると RangeError: Out of memory になる原因を、1 回の実行で切り分けるためのもの。
 * 結果は日本語の 1 行ずつで `log` に渡す（不具合の報告に貼る）
 */
export type Log = (line: string) => void

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sec = (t0: number) => ((performance.now() - t0) / 1000).toFixed(1)

/** `code` を使い捨ての Worker で動かし、最初に返ってきた値を受け取る */
function runWorker<T>(code: string, input?: unknown, transfer: Transferable[] = []): Promise<T | string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const worker = new Worker(url)
    const done = (v: T | string) => {
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(v)
    }
    worker.onmessage = (e: MessageEvent<T>) => done(e.data)
    worker.onerror = (e) => done(`Worker を作れない: ${e.message}`)
    worker.postMessage(input, transfer)
  })
}

const MEMORY_TEST = `onmessage = () => {
const kinds = [
  ['共有、上限 4GB', { initial: 17, maximum: 65536, shared: true }],
  ['共有、上限 1GB', { initial: 17, maximum: 16384, shared: true }],
  ['共有、上限 256MB', { initial: 17, maximum: 4096, shared: true }],
  ['共有でない、上限 4GB', { initial: 17, maximum: 65536 }],
  ['共有でない、最初から 256MB', { initial: 4096 }],
]
const out = []
for (const [name, desc] of kinds) {
  try { new WebAssembly.Memory(desc); out.push(name + ': OK') }
  catch (e) { out.push(name + ': 失敗 (' + e + ')') }
}
for (const [name, desc] of [kinds[0], kinds[3]]) {
  const held = []
  try { while (held.length < 64) held.push(new WebAssembly.Memory(desc)) } catch {}
  out.push(name + ' を同時に: ' + held.length + (held.length >= 64 ? ' 個以上' : ' 個まで'))
}
let grown = 0
try { const m = new WebAssembly.Memory({ initial: 17, maximum: 65536, shared: true }); while (grown < 1024) { m.grow(1024); grown += 64 } } catch {}
out.push('共有、上限 4GB を 64MB ずつ増やして: ' + grown + 'MB' + (grown >= 1024 ? ' 以上' : ' まで'))
postMessage(out)
}`

/** 上限 4GB の共有メモリを作り、256MB まで増やしてから返事をする（止めた Worker の分が返るかを見る） */
const HOLD_TEST = `onmessage = () => {
try { const m = new WebAssembly.Memory({ initial: 17, maximum: 65536, shared: true }); m.grow(4096 - 17); self.m = m; postMessage('OK') }
catch (e) { postMessage('失敗 (' + e + ')') }
}`

const COMPILE_TEST = `onmessage = async (e) => {
  const t0 = performance.now()
  try { await WebAssembly.compile(e.data); postMessage('OK（' + ((performance.now() - t0) / 1000).toFixed(1) + ' 秒）') }
  catch (err) { postMessage('失敗 (' + err + ')') }
}`

/** 環境 */
export function diagnoseEnv(log: Log) {
  const nav = navigator as Navigator & { standalone?: boolean; deviceMemory?: number; gpu?: unknown }
  log(`ブラウザ: ${navigator.userAgent}`)
  log(`PWA として開いている: ${window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true}`)
  log(`crossOriginIsolated: ${String(window.crossOriginIsolated)} / SharedArrayBuffer: ${typeof SharedArrayBuffer} / WebGPU: ${'gpu' in nav}`)
  log(`論理コア: ${navigator.hardwareConcurrency}${nav.deviceMemory ? ` / deviceMemory: ${nav.deviceMemory}GB` : ''}`)
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
  if (perf.memory) log(`JS ヒープ: ${(perf.memory.usedJSHeapSize / 2 ** 20).toFixed(0)}MB / ${(perf.memory.jsHeapSizeLimit / 2 ** 20).toFixed(0)}MB`)
}

type GpuAdapter = { info?: { vendor?: string; architecture?: string; device?: string; description?: string }; limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number } }
type Gpu = { requestAdapter(o?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapter | null> }

/**
 * WebGPU: アダプターが取れるか（既定と高性能の指定で）、取れたら GPU の名前と、1 つのバッファーの大きさの上限。
 * Chrome は、あるサイトで GPU のデバイスが何度も失われると、ブラウザを再起動するまでそのサイトの requestAdapter に null を返す
 * （chrome://gpu では WebGPU が使える表示のまま）
 */
export async function diagnoseWebGpu(log: Log) {
  log('--- WebGPU')
  const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu
  if (!gpu) return log('navigator.gpu が無い（このブラウザは WebGPU に対応していない）')
  for (const [label, opts] of [['既定', undefined], ['高性能を指定', { powerPreference: 'high-performance' as const }]] as const) {
    try {
      const a = await gpu.requestAdapter(opts)
      if (!a) {
        log(`${label}: requestAdapter が null（WebGPU を使えない。ブラウザがこのサイトの WebGPU を止めている可能性。ブラウザを完全に終了して開き直す）`)
        continue
      }
      const name = [a.info?.vendor, a.info?.architecture, a.info?.device, a.info?.description].filter(Boolean).join(' / ') || '（名前なし）'
      const mb = (n?: number) => (n ? `${Math.round(n / 2 ** 20)}MB` : '?')
      log(`${label}: OK（${name}。maxBufferSize ${mb(a.limits?.maxBufferSize)}、maxStorageBufferBindingSize ${mb(a.limits?.maxStorageBufferBindingSize)}）`)
    } catch (e) {
      log(`${label}: 例外 ${String(e)}`)
    }
  }
}
/** wasm のメモリ: 作れるか、同時にいくつ持てるか、どこまで増やせるか、止めた Worker の分がいつ返るか */
export async function diagnoseMemory(log: Log) {
  log('--- wasm のメモリ（使い捨ての Worker の中）')
  const lines = await runWorker<string[]>(MEMORY_TEST)
  for (const line of typeof lines === 'string' ? [lines] : lines) log(line)
  log('--- 止めた Worker のメモリが返るか（256MB を持つ Worker を作って止める、を続ける）')
  const results: string[] = []
  for (let i = 0; i < 8; i++) results.push(String(await runWorker<string>(HOLD_TEST)))
  log(`待たずに 8 回: ${results.map((r) => (r === 'OK' ? 'OK' : '×')).join(' ')}`)
  const fail = results.find((r) => r !== 'OK')
  if (fail) log(`失敗の内容: ${fail}`)
  for (const ms of [1000, 3000]) {
    await wait(ms)
    log(`${ms / 1000} 秒待って: ${await runWorker<string>(HOLD_TEST)}`)
  }
}

/** 実行環境の wasm（`bytes`）を、使い捨ての Worker でコンパイルだけする */
export async function diagnoseCompile(bytes: ArrayBuffer, log: Log) {
  log(`--- 実行環境の wasm（${(bytes.byteLength / 2 ** 20).toFixed(0)}MB）のコンパイル`)
  log(`コンパイル: ${await runWorker<string>(COMPILE_TEST, bytes, [bytes])}`)
}

/** 試す組み合わせ（モデルと計算の種類）。`create` は実行環境を作り、手放すための dispose を返す */
export interface RuntimePattern {
  label: string
  create: () => Promise<{ dispose(): void }>
}

/** 実行環境: 組み合わせごとに、作る → 手放す を続けて 2 回、3 秒待ってからもう 1 回 */
export async function diagnoseRuntime(patterns: RuntimePattern[], log: Log, title = '') {
  for (const p of patterns) {
    log(`--- 実行環境（${p.label}${title}）`)
    for (const [n, before] of [[1, 0], [2, 0], [3, 3000]] as const) {
      if (before) await wait(before)
      const t0 = performance.now()
      const head = `${n} 回目${before ? `（${before / 1000} 秒待って）` : ''}`
      try {
        ;(await p.create()).dispose()
        log(`${head}: OK（${sec(t0)} 秒）`)
      } catch (e) {
        log(`${head}: 失敗（${sec(t0)} 秒）${String(e)}`)
      }
    }
    // 次の組み合わせの前に、返るのを待つ
    await wait(3000)
  }
}
/** WebGPU のアダプターが取れるか */
export async function webGpuAvailable() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  try {
    return !!(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}
