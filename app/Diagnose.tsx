import { useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useHighlighter } from 'pevenmui'
import { createExtractor, type Backend } from '../src/index'
import { diagnoseEnv, diagnoseMemory, diagnoseRuntime, webGpuAvailable, type RuntimePattern } from '../src/diagnose'
import { useT } from './i18n'
import { loadModels, MODELS, type ModelKind } from './models'

/** 診断を行い、結果を1行ずつ `log` に渡す（内容は src/diagnose.ts。WeVocalSynth と同じ） */
async function diagnose(memoryMb: number, log: (line: string) => void) {
  diagnoseEnv(log)
  await diagnoseMemory(log)
  // モデル 3 種類と、WebGPU を使う / 使わないの 6 通り（fp16 の WebGPU は出力が 0 になるが、作れるかは試す）
  const backends: Backend[] = (await webGpuAvailable()) ? ['wasm', 'webgpu'] : ['wasm']
  if (backends.length === 1) log('WebGPU が使えないため、WebGPU の組み合わせは省略')
  const patterns: RuntimePattern[] = []
  for (const kind of Object.keys(MODELS) as ModelKind[]) {
    let models: Awaited<ReturnType<typeof loadModels>> | null = null
    const get = async () => (models ??= await loadModels(kind, () => {}, new AbortController().signal))
    for (const backend of backends)
      patterns.push({
        label: `${kind}、${backend}`,
        create: async () => {
          const m = await get()
          return createExtractor({ vocals: m.vocals.slice(0), accompaniment: m.accompaniment.slice(0), backend, memoryMb })
        },
      })
  }
  await diagnoseRuntime(patterns, log)
}
/** 設定の開発者向け「抽出の診断」。結果は選んでコピーできる（不具合の報告に貼る） */
export default function Diagnose({ memoryMb }: { memoryMb: number }) {
  const t = useT()
  const hit = useHighlighter()
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    setLines([])
    try {
      await diagnose(memoryMb, (line) => setLines((l) => [...l, line]))
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
