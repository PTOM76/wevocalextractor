import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Paper, Snackbar, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faFileAudio, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
import { Check, Choice, Group, NarrowContext, Row, useDesktop } from 'pevenmui'
import { AUDIO_ACCEPT, downloadBlob } from './audio'
import { t } from './i18n'
import { clearModels, MODELS, type ModelKind } from './models'
import UpdatePrompt from './UpdatePrompt'
import { useExtract, type Result, type Stage } from './useExtract'

/** 設定の保存先（localStorage） */
const SETTINGS_KEY = 'wevocalextractor.settings'

interface Settings {
  model: ModelKind
  gpu: boolean
  highBand: boolean
}

const DEFAULT_SETTINGS: Settings = { model: 'int8', gpu: true, highBand: false }

function useSettings() {
  const [s, setS] = useState<Settings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
    } catch {
      return DEFAULT_SETTINGS
    }
  })
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch }
    setS(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // 保存できなくても、このセッション中は使う
    }
  }
  return [s, update] as const
}

const stageLabel = (s: Stage) => {
  const p = Math.round((s.progress ?? 0) * 100)
  if (s.kind === 'decode') return t('stageDecode')
  if (s.kind === 'model') return t('stageModel', { p })
  if (s.kind === 'init') return t('stageInit')
  return t('stageSeparate', { p })
}

/** 拡張子を除いたファイル名 */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export default function App() {
  const desktop = useDesktop()
  const [settings, update] = useSettings()
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ex = useExtract()
  const busy = !!ex.stage

  const pick = (f: File | undefined) => {
    if (!f) return
    ex.reset()
    setFile(f)
  }

  return (
    <NarrowContext.Provider value={!desktop}>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
        <Box component="header" sx={{ px: 2, height: 48, display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>{t('title')}</Typography>
        </Box>

        <Box component="main" sx={{ flex: 1, width: '100%', maxWidth: 720, mx: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography className="selectable" sx={{ fontSize: 14, color: 'text.secondary' }}>
            {t('lead')}
          </Typography>

          {/* ファイル: ドロップかボタンで選ぶ */}
          <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
          <Paper
            variant="outlined"
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (!busy) pick(e.dataTransfer.files[0])
            }}
            sx={{
              p: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              borderStyle: 'dashed',
              borderColor: dragging ? 'primary.main' : 'divider',
              bgcolor: dragging ? 'action.hover' : 'background.paper',
            }}
          >
            {file ? (
              <Typography className="selectable" sx={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 1, wordBreak: 'break-all' }}>
                <FontAwesomeIcon icon={faFileAudio} />
                {file.name}
              </Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 14 }}>{t('drop')}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('formats')}</Typography>
              </>
            )}
            <Button variant={file ? 'text' : 'contained'} size="small" disabled={busy} startIcon={<FontAwesomeIcon icon={faFolderOpen} />} onClick={() => inputRef.current?.click()}>
              {file ? t('change') : t('open')}
            </Button>
          </Paper>

          <Group title={t('groupModel')}>
            <Row label={t('model')}>
              <Choice
                value={settings.model}
                onChange={(model) => update({ model })}
                options={[
                  ['fp16', t('modelLight', { mb: MODELS.fp16.mb })],
                  ['int8', t('modelStandard', { mb: MODELS.int8.mb })],
                  ['fp32', t('modelPrecise', { mb: MODELS.fp32.mb })],
                ]}
              />
            </Row>
            <Check checked={settings.gpu} onChange={(gpu) => update({ gpu })} label={t('gpu')} help={t('gpuHelp')} />
            <Check checked={settings.highBand} onChange={(highBand) => update({ highBand })} label={t('highBand')} help={t('highBandHelp')} />
          </Group>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button variant="contained" disabled={!file || busy} onClick={() => file && ex.run(file, settings)}>
              {t('extract')}
            </Button>
            {busy && <Button onClick={ex.cancel}>{t('cancel')}</Button>}
            <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 'auto' }}>{t('note')}</Typography>
          </Box>

          {ex.stage && (
            <Box>
              <Typography sx={{ fontSize: 13, mb: 0.5 }}>{stageLabel(ex.stage)}</Typography>
              <LinearProgress variant={ex.stage.progress === undefined ? 'indeterminate' : 'determinate'} value={(ex.stage.progress ?? 0) * 100} />
            </Box>
          )}

          {ex.error && (
            <Alert severity="error" className="selectable">
              {t('failed', { message: ex.error })}
            </Alert>
          )}

          {ex.result && file && <Results result={ex.result} name={baseName(file.name)} />}
        </Box>

        <Box component="footer" sx={{ px: 2, py: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            color="inherit"
            disabled={busy}
            onClick={async () => {
              await clearModels()
              setToast(t('cleared'))
            }}
            sx={{ color: 'text.secondary' }}
          >
            {t('clearModels')}
          </Button>
        </Box>
      </Box>
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
      <UpdatePrompt />
    </NarrowContext.Provider>
  )
}

/** 取り出した2つの音。それぞれ試聴と保存ができる */
function Results({ result, name }: { result: Result; name: string }) {
  const urls = useMemo(() => ({ vocals: URL.createObjectURL(result.vocals), accompaniment: URL.createObjectURL(result.accompaniment) }), [result])
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls])

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(['vocals', 'accompaniment'] as const).map((stem) => (
        <Box key={stem}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{t(stem)}</Typography>
            <Button size="small" sx={{ ml: 'auto' }} startIcon={<FontAwesomeIcon icon={faDownload} />} onClick={() => downloadBlob(result[stem], `${name}_${stem}.wav`)}>
              {t('download')}
            </Button>
          </Box>
          <audio controls src={urls[stem]} style={{ width: '100%' }} />
        </Box>
      ))}
    </Paper>
  )
}
