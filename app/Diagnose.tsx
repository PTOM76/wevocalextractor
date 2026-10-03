import { useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useHighlighter } from 'pevenmui'
import { createExtractor } from '../src/index'
import { useT } from './i18n'
import { hasWebGpu, loadModels, MODELS } from './models'
import type { Settings } from './settings'

/** 使い捨ての Worker の中で、上限の違う wasm のメモリを作れるか試す（WeVocalSynth の診断と同じ内容） */
const MEMORY_TEST = `
const tests = [
  ['共有、上限 4GB', { initial: 17, maximum: 65536, shared: true }],
  ['共有、上限 1GB', { initial: 17, maximum: 16384, shared: true }],
  ['共有、上限 256MB', { initial: 17, maximum: 4096, shared: true }],
  ['共有でない、上限 4GB', { initial: 17, maximum: 65536 }],
  ['共有でない、最初から 256MB', { initial: 4096 }],
]
const out = []
for (const [name, desc] of tests) {
  try { new WebAssembly.Memory(desc); out.push(name + ': OK') }
  catch (e) { out.push(name + ': 失敗 (' + e + ')') }
}
postMessage(out)
`

function testMemory(): Promise<string[]> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([MEMORY_TEST], { type: 'text/javascript' }))
    const worker = new Worker(url)
    const done = (lines: string[]) => {
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(lines)
    }
    worker.onmessage = (e: MessageEvent<string[]>) => done(e.data)
    worker.onerror = (e) => done([`Worker を作れない: ${e.message}`])
  })
}

/** 診断を行い、結果を1行ずつ `log` に渡す */
async function diagnose(settings: Settings, log: (line: string) => void) {
  const nav = navigator as Navigator & { standalone?: boolean; deviceMemory?: number }
  log(`ブラウザ: ${navigator.userAgent}`)
  log(`PWA として開いている: ${window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true}`)
  log(`crossOriginIsolated: ${String(window.crossOriginIsolated)} / SharedArrayBuffer: ${typeof SharedArrayBuffer}`)
  if (nav.deviceMemory) log(`deviceMemory: ${nav.deviceMemory}GB`)
  log('--- wasm のメモリ（使い捨ての Worker の中）')
  for (const line of await testMemory()) log(line)
  log(`--- 抽出の実行環境（モデル ${settings.model}、作る → 手放す、を 2 回続ける）`)
  const models = await loadModels(settings.model, () => {}, new AbortController().signal)
  const gpu = settings.gpu && MODELS[settings.model].webgpu && (await hasWebGpu())
  for (const n of [1, 2]) {
    const t0 = performance.now()
    const sec = () => ((performance.now() - t0) / 1000).toFixed(1)
    try {
      const ex = await createExtractor({ vocals: models.vocals.slice(0), accompaniment: models.accompaniment.slice(0), backend: gpu ? 'webgpu' : 'wasm' })
      ex.dispose()
      log(`${n} 回目: OK（${sec()} 秒、${gpu ? 'webgpu' : 'wasm'}）`)
    } catch (e) {
      log(`${n} 回目: 失敗（${sec()} 秒）${String(e)}`)
    }
  }
}

/** 設定の開発者向け「抽出の診断」。結果は選んでコピーできる（不具合の報告に貼る） */
export default function Diagnose({ settings }: { settings: Settings }) {
  const t = useT()
  const hit = useHighlighter()
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    setLines([])
    try {
      await diagnose(settings, (line) => setLines((l) => [...l, line]))
    } catch (e) {
      setLines((l) => [...l, String(e)])
    } finally {
      setRunning(false)
    }
  }
  return (
    // 幅を設定の表の列幅の計算に入れない（長い説明やログでラベル列が広がる）
    <Box sx={{ gridColumn: '1 / -1', contain: 'inline-size', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, width: 'fit-content', ...hit(t('settings.diagnose'), t('settings.diagnoseHelp')) }}>{t('settings.diagnose')}</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{t('settings.diagnoseHelp')}</Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={running} onClick={() => void run()}>
          {t(running ? 'settings.diagnoseRunning' : 'settings.diagnoseRun')}
        </Button>
      </Box>
      {lines.length > 0 && (
        <Box
          className="selectable"
          sx={{ font: '11px/1.5 ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', p: 1, borderRadius: 1, bgcolor: 'action.hover', userSelect: 'text' }}
        >
          {lines.join('\n')}
        </Box>
      )}
    </Box>
  )
}
