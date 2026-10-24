// 抽出の診断（アプリの設定の開発者向け。WeVocalSynth と WeVocal Studio で共通）。diagnose.ts の試しに、アプリの実行環境とモデルでの抽出を足したもの
import { backendAllowed } from './compat'
import { diagnoseCompile, diagnoseEnv, diagnoseMemory, diagnoseRuntime, diagnoseWebGpu, webGpuAvailable, type Log, type RuntimePattern } from './diagnose'
import { RUNTIME_ADDONS, VOCAL_MODELS, type createHost, type ExtractOptions, type HostIO, type VocalModel } from './host'
import type { Backend } from './types'

/**
 * 抽出の診断。環境、WebGPU、メモリを調べ、入っている実行環境とモデルの組み合わせで実行環境を作れるか試す。
 * 先にいまの設定で（アプリの Worker を残したまま）試し、`io.beforeOpen` でメモリを空けてから、モデルごとに試す
 */
export async function diagnoseExtract(h: ReturnType<typeof createHost>, io: HostIO, o: ExtractOptions, log: Log) {
  // 抽出中に作ると、抽出のモデルを入れ替えてしまう
  if (h.isExtracting()) return log('抽出中のため診断できません。抽出が終わってから実行してください')
  diagnoseEnv(log, o.threads)
  await diagnoseWebGpu(log)
  await diagnoseMemory(log)
  if (!(await io.installedManifest('vocal-extractor'))) return log('ボーカル抽出の実行環境が未導入のため、実行環境の試しは省略')
  // 計算の種類ごとの ONNX Runtime（追加機能）。入っているものだけ試す
  const backends: Backend[] = []
  for (const [backend, id] of [['wasm', RUNTIME_ADDONS.cpu], ['webgpu', RUNTIME_ADDONS.gpu]] as const) {
    const wasm = (await io.installedManifest(id))?.files.find((f) => f.path.endsWith('.wasm'))
    if (!wasm) {
      log(`${id} が未導入のため、${backend} の組み合わせは省略`)
      continue
    }
    if (backend === 'webgpu' && !(await webGpuAvailable())) {
      log('WebGPU が使えないため、WebGPU の組み合わせは省略')
      continue
    }
    await diagnoseCompile(await (await fetch(io.addonFileUrl(id, wasm.path))).arrayBuffer(), log)
    backends.push(backend)
  }
  const current: Backend = o.gpu && backendAllowed(o.model, 'webgpu') && backends.includes('webgpu') ? 'webgpu' : 'wasm'
  if (backends.includes(current)) await diagnoseRuntime([{ label: `${o.model}、${current}`, create: () => h.openExtractor(o, current) }], log, '、いまの設定、加工の Worker を残したまま')
  io.beforeOpen?.()
  await new Promise((r) => setTimeout(r, 3000))
  // 入っているモデルと、WebGPU を使う / 使わないの組み合わせ（fp16 の WebGPU は出力が 0 になるが、作れるかは試す）
  const patterns: RuntimePattern[] = []
  for (const model of Object.keys(VOCAL_MODELS) as VocalModel[]) {
    if (!(await io.installedManifest(VOCAL_MODELS[model].addon))) {
      log(`モデル ${model} は未導入のため省略`)
      continue
    }
    for (const backend of backends) patterns.push({ label: `${model}、${backend}`, create: () => h.openExtractor({ ...o, model }, backend) })
  }
  await diagnoseRuntime(patterns, log, '、加工の Worker を止めたあと')
}
