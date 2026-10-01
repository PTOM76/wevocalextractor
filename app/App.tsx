import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Link, Paper, Snackbar, Stack, Typography, useColorScheme } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faFileArrowUp, faFileAudio, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
import { AboutDialog, AppHeader, PevenLabels, ShortcutsDialog, enLabels, jaLabels, useFileDrop, type MenuGroup } from 'pevenmui'
import { UpdatePrompt, formatBuild } from 'pevenmui/pwa'
import { AUDIO_ACCEPT, downloadBlob } from './audio'
import { LangContext, resolveLang, setLang, t } from './i18n'
import SettingsDialog from './SettingsDialog'
import { useSettings } from './settings'
import { useExtract, type Result, type Stage } from './useExtract'

const REPOSITORY_URL = 'https://github.com/PTOM76/wevocalextractor'
const AUTHOR = 'PitaQ'
/** 今動いている版（バージョンとコミット） */
const APP_BUILD = formatBuild(__APP_VERSION__, __APP_COMMIT__)

/** アプリのアイコン（public/icon.svg）。GitHub Pages ではサブパスで配信されるため BASE_URL から組み立てる */
const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

const stageLabel = (s: Stage) => {
  const p = Math.round((s.progress ?? 0) * 100)
  if (s.kind === 'decode') return t('stage.decode')
  if (s.kind === 'model') return t('stage.model', { p })
  if (s.kind === 'init') return t('stage.init')
  return t('stage.separate', { p })
}

/** 拡張子を除いたファイル名 */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export default function App() {
  const [settings, updateSettings] = useSettings()
  // 子の描画より先に言語を切り替えておく（t() は描画中に参照される）
  const lang = resolveLang(settings.language)
  setLang(lang)
  // 設定のテーマ（既定 / ライト / ダーク）を反映する
  const { setMode } = useColorScheme()
  useEffect(() => setMode(settings.theme), [settings.theme, setMode])

  const [file, setFile] = useState<File | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const ex = useExtract()
  const busy = !!ex.stage

  const pick = (f: File | undefined) => {
    if (!f || busy) return
    ex.reset()
    setFile(f)
  }
  const openFile = () => !busy && inputRef.current?.click()
  const extract = () => file && !busy && void ex.run(file, settings)
  const save = (stem: keyof Result) => ex.result && file && downloadBlob(ex.result[stem], `${baseName(file.name)}_${stem}.wav`)

  // ページのどこにドロップしても開く
  useFileDrop(pick)
  // Ctrl+O で開く（ダイアログを開いているときは効かせない）
  const openRef = useRef(openFile)
  openRef.current = openFile
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      entries: [
        { label: t('menu.open'), shortcut: 'Ctrl+O', disabled: busy, onClick: openFile },
        { divider: true },
        { label: t('menu.saveVocals'), disabled: !ex.result, onClick: () => save('vocals') },
        { label: t('menu.saveAccompaniment'), disabled: !ex.result, onClick: () => save('accompaniment') },
      ],
    },
    {
      label: t('menu.tools'),
      entries: [
        { label: t('menu.extract'), disabled: !file || busy, onClick: extract },
        { divider: true },
        { label: t('menu.settings'), onClick: () => setSettingsOpen(true) },
      ],
    },
    {
      label: t('menu.help'),
      entries: [
        { label: t('menu.shortcuts'), onClick: () => setShortcutsOpen(true) },
        { label: t('menu.about'), onClick: () => setAboutOpen(true) },
      ],
    },
  ]

  return (
    <LangContext.Provider value={lang}>
      <PevenLabels.Provider value={lang === 'ja_jp' ? jaLabels : enLabels}>
        <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
          <AppHeader title="WeVocalExtractor" icon={<AppIcon size={16} />} menus={menus} />
          <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />

          <Box component="main" sx={{ flex: 1, width: '100%', maxWidth: 720, mx: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!file ? (
              // ファイルを開く前の画面（WeVocalSynth の EmptyState と同じ形）
              <Stack spacing={2} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <Box sx={{ color: 'text.secondary', fontSize: 40 }}>
                  <FontAwesomeIcon icon={faFileArrowUp} />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {t('empty.formats')}
                </Typography>
                <Button variant="contained" startIcon={<FontAwesomeIcon icon={faFolderOpen} />} onClick={openFile}>
                  {t('empty.choose')}
                </Button>
              </Stack>
            ) : (
              <>
                <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <FontAwesomeIcon icon={faFileAudio} />
                  <Typography className="selectable" sx={{ fontSize: 14, flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                    {file.name}
                  </Typography>
                  <Button size="small" disabled={busy} onClick={openFile}>
                    {t('file.change')}
                  </Button>
                </Paper>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="contained" disabled={busy} onClick={extract}>
                    {t('extract.run')}
                  </Button>
                  {busy && <Button onClick={ex.cancel}>{t('extract.cancel')}</Button>}
                </Box>

                {ex.stage && (
                  <Box>
                    <Typography sx={{ fontSize: 13, mb: 0.5 }}>{stageLabel(ex.stage)}</Typography>
                    <LinearProgress variant={ex.stage.progress === undefined ? 'indeterminate' : 'determinate'} value={(ex.stage.progress ?? 0) * 100} />
                  </Box>
                )}

                {ex.error && (
                  <Alert severity="error" className="selectable">
                    {t('error.failed', { message: ex.error })}
                  </Alert>
                )}

                {ex.result && <Results result={ex.result} onSave={save} />}
              </>
            )}
          </Box>
        </Box>

        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={updateSettings} notify={setToast} />
        <AboutDialog
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          icon={<AppIcon size={56} />}
          name="WeVocalExtractor"
          rows={[
            [t('about.version'), <span className="selectable">{APP_BUILD}</span>],
            [t('about.author'), AUTHOR],
            [
              'GitHub',
              <Link className="selectable" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
                {REPOSITORY_URL.replace('https://', '')}
              </Link>,
            ],
            [t('about.license'), t('about.licenseText')],
          ]}
        />
        <ShortcutsDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          title={t('menu.shortcuts')}
          rows={[
            ['Ctrl+O', t('shortcuts.open')],
            [t('shortcuts.drop'), t('shortcuts.dropDesc')],
            ['Alt / F10', t('shortcuts.menu')],
          ]}
        />
        <UpdatePrompt build={APP_BUILD} />
        <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
      </PevenLabels.Provider>
    </LangContext.Provider>
  )
}

/** 取り出した2つの音。それぞれ試聴と保存ができる */
function Results({ result, onSave }: { result: Result; onSave: (stem: keyof Result) => void }) {
  const urls = useMemo(() => ({ vocals: URL.createObjectURL(result.vocals), accompaniment: URL.createObjectURL(result.accompaniment) }), [result])
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls])

  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(['vocals', 'accompaniment'] as const).map((stem) => (
        <Box key={stem}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{t(stem === 'vocals' ? 'stem.vocals' : 'stem.accompaniment')}</Typography>
            <Button size="small" sx={{ ml: 'auto' }} startIcon={<FontAwesomeIcon icon={faDownload} />} onClick={() => onSave(stem)}>
              {t('result.download')}
            </Button>
          </Box>
          <audio controls src={urls[stem]} style={{ width: '100%' }} />
        </Box>
      ))}
    </Paper>
  )
}
