import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Link, MenuItem, Paper, Select, Snackbar, Stack, Typography, useColorScheme } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faFileArrowUp, faFolderOpen, faPlus } from '@fortawesome/free-solid-svg-icons'
import { AboutDialog, AppHeader, PevenLabels, ShortcutsDialog, LABELS, useFilesDrop, useMobileLayout, WindowModeContext, autoWindowMode, type MenuGroup } from 'pevenmui'
import { UpdatePrompt, checkForUpdate, formatBuild, promptUpdate } from 'pevenmui/pwa'
import { AUDIO_ACCEPT, downloadBlob, type ExportFormat } from 'wevocal-lib'
import { openExternal, USER_GUIDE_URL } from './links'
import { LangContext, resolveLang, setLang, t, type MessageKey } from './i18n'
import type { ModelKind } from './models'
import { QueueList, type Stem } from './QueueList'
import SettingsDialog from './SettingsDialog'
import { useSettings, type StemsSetting } from './settings'
import { useQueue, type Phase, type QueueItem } from './useQueue'
import { makeZip } from './zip'

const REPOSITORY_URL = 'https://github.com/PTOM76/wevocalextractor'
const AUTHOR = 'PitaQ'
/** 今動いている版（バージョンとコミット） */
const APP_BUILD = formatBuild(__APP_VERSION__, __APP_COMMIT__)

/** アプリのアイコン（public/icon.svg）。GitHub Pages ではサブパスで配信されるため BASE_URL から組み立てる */
const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

const MODEL_OPTIONS: [ModelKind, MessageKey][] = [
  ['fp16', 'opt.modelLight'],
  ['int8', 'opt.modelStandard'],
  ['fp32', 'opt.modelPrecise'],
]
const FORMAT_OPTIONS: [ExportFormat, MessageKey][] = [
  ['wav', 'opt.formatWav'],
  ['mp3', 'opt.formatMp3'],
  ['opus', 'opt.formatOpus'],
]
const STEMS_OPTIONS: [StemsSetting, MessageKey][] = [
  ['both', 'opt.stemsBoth'],
  ['vocals', 'opt.stemsVocals'],
  ['accompaniment', 'opt.stemsAccompaniment'],
]

const phaseLabel = (p: NonNullable<Phase>) => (p.kind === 'model' ? t('stage.model', { p: Math.round(p.progress * 100) }) : t('stage.init'))

/** 拡張子を除いたファイル名 */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '')
const outName = (item: QueueItem, stem: Stem) => `${baseName(item.file.name)}_${stem}${item.ext ?? '.wav'}`

/** 操作の帯に置く選択欄（ラベル付き） */
function OptionSelect<T extends string>(p: { label: string; value: T; disabled: boolean; options: [T, MessageKey][]; onChange: (v: T) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }}>{p.label}</Typography>
      <Select size="small" value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value as T)} sx={{ fontSize: 13, '& .MuiSelect-select': { py: 0.5 } }}>
        {p.options.map(([v, k]) => (
          <MenuItem key={v} value={v} sx={{ fontSize: 13 }}>
            {t(k)}
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}

export default function App() {
  const [settings, updateSettings] = useSettings()
  // 子の描画より先に言語を切り替えておく（t() は描画中に参照される）
  const lang = resolveLang(settings.language)
  setLang(lang)
  // 設定のテーマ（既定 / ライト / ダーク）を反映する
  const { setMode } = useColorScheme()
  useEffect(() => setMode(settings.theme), [settings.theme, setMode])
  const mobile = useMobileLayout()

  const [toast, setToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 設定を開いたまま、もう一度「設定」を押したら、別の窓で開いている設定画面を手前に出す
  const [settingsFocus, setSettingsFocus] = useState(0)
  const openSettings = () => {
    setSettingsOpen(true)
    setSettingsFocus((n) => n + 1)
  }
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = useQueue(settings)
  const hasWaiting = q.items.some((it) => it.status === 'waiting')
  const done = q.items.filter((it) => it.vocals || it.accompaniment)

  const openFiles = () => inputRef.current?.click()
  // ダウンロードした結果は、次に開いたときには残さない（画面の一覧からは消さない）
  const save = (item: QueueItem, stem: Stem) => {
    const blob = item[stem]
    if (!blob) return
    downloadBlob(blob, outName(item, stem))
    q.markSaved(item.id, [stem])
  }
  // 抽出済みのものを1つの ZIP にまとめて保存する
  const saveAll = async () => {
    const stems = ['vocals', 'accompaniment'] as const
    const files = done.flatMap((it) => stems.flatMap((s) => (it[s] ? [{ name: outName(it, s), blob: it[s] }] : [])))
    if (!files.length) return
    downloadBlob(await makeZip(files), 'wevocalextractor.zip')
    for (const it of done) q.markSaved(it.id, stems.filter((s) => it[s]))
  }

  // ページのどこにドロップしても一覧に足す
  useFilesDrop(q.add)
  // Ctrl+O で追加（ダイアログを開いているときは効かせない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        inputRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 新しい版があれば、右下の通知（UpdatePrompt）からそのまま更新できる。ここでは結果だけを知らせる
  const checkUpdate = () =>
    void checkForUpdate().then((r) => {
      if (r.kind === 'found') return promptUpdate(r.build)
      const l = LABELS[lang]
      setToast({ latest: l.updateLatest, unsupported: l.updateUnsupported, failed: l.updateFailed }[r.kind])
    })
  const runEntries = [
    { label: t('menu.runAll'), disabled: q.running || !hasWaiting, onClick: () => void q.run() },
    { label: t('menu.clear'), disabled: !q.items.length, onClick: q.clear },
  ]
  const guide = { label: t('menu.userGuide'), onClick: () => openExternal(USER_GUIDE_URL) }
  // WeVocalSynth と同じ並び。設定はファイルに、更新の確認はヘルプに置く
  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      accessKey: 'F',
      entries: [
        { label: t('menu.add'), shortcut: 'Ctrl+O', onClick: openFiles },
        { divider: true },
        { label: t('menu.saveAll'), disabled: !done.length, onClick: () => void saveAll() },
        { divider: true },
        { label: t('menu.settings'), onClick: openSettings },
      ],
    },
    { label: t('menu.tools'), accessKey: 'T', entries: runEntries },
    {
      label: t('menu.help'),
      accessKey: 'H',
      entries: [
        guide,
        { label: t('menu.shortcuts'), onClick: () => setShortcutsOpen(true) },
        { divider: true },
        { label: t('menu.checkUpdate'), onClick: checkUpdate },
        { label: t('menu.about'), onClick: () => setAboutOpen(true) },
      ],
    },
  ]
  // スマホの ⋮ は WeVocalSynth と同じく、設定をヘルプに置き、ショートカット一覧は出さない
  const mobileMenus: MenuGroup[] = [
    {
      label: t('menu.file'),
      entries: [
        { label: t('menu.add'), onClick: openFiles },
        { label: t('menu.saveAll'), disabled: !done.length, onClick: () => void saveAll() },
      ],
    },
    { label: t('menu.tools'), entries: runEntries },
    {
      label: t('menu.help'),
      entries: [
        { label: t('menu.settings'), onClick: openSettings },
        guide,
        { label: t('menu.checkUpdate'), onClick: checkUpdate },
        { label: t('menu.about'), onClick: () => setAboutOpen(true) },
      ],
    },
  ]
  return (
    <LangContext.Provider value={lang}>
      <PevenLabels.Provider value={LABELS[lang]}>
      <WindowModeContext.Provider value={settings.dialogWindow === 'auto' ? autoWindowMode() : settings.dialogWindow}>
        <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}>
          <AppHeader title="WeVocalExtractor" icon={<AppIcon size={16} />} menus={mobile ? mobileMenus : menus} />
          <input
            ref={inputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              q.add(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          {/* 操作の帯: モデル・抽出するもの・形式と、一覧への操作 */}
          <Paper square elevation={0} sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
            <OptionSelect label={t('opt.model')} value={settings.model} disabled={q.running} options={MODEL_OPTIONS} onChange={(model) => updateSettings({ model })} />
            <OptionSelect label={t('opt.stems')} value={settings.stems} disabled={q.running} options={STEMS_OPTIONS} onChange={(stems) => updateSettings({ stems })} />
            <OptionSelect label={t('opt.format')} value={settings.format} disabled={q.running} options={FORMAT_OPTIONS} onChange={(format) => updateSettings({ format })} />
            <Box sx={{ display: 'flex', gap: 1, ml: mobile ? 0 : 'auto' }}>
              <Button size="small" startIcon={<FontAwesomeIcon icon={faPlus} />} onClick={openFiles}>
                {t('queue.add')}
              </Button>
              {q.running ? (
                <Button size="small" variant="outlined" onClick={q.cancel}>
                  {t('queue.cancel')}
                </Button>
              ) : (
                <Button size="small" variant="contained" disabled={!hasWaiting} onClick={() => void q.run()}>
                  {t('queue.runAll')}
                </Button>
              )}
              <Button size="small" disabled={!done.length} startIcon={<FontAwesomeIcon icon={faDownload} />} onClick={() => void saveAll()}>
                {t('queue.saveAll')}
              </Button>
            </Box>
          </Paper>
          {q.phase && q.phase.kind !== 'separate' && (
            <Box sx={{ px: 2, pt: 1 }}>
              <Typography sx={{ fontSize: 12, mb: 0.5 }}>{phaseLabel(q.phase)}</Typography>
              <LinearProgress variant={q.phase.kind === 'model' ? 'determinate' : 'indeterminate'} value={q.phase.kind === 'model' ? q.phase.progress * 100 : 0} />
            </Box>
          )}

          <Box component="main" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {q.error && (
              <Alert severity="error" className="selectable">
                {t('error.failed', { message: q.error })}
              </Alert>
            )}
            {q.items.length ? (
              <QueueList items={q.items} busy={q.running} onSave={save} onExtract={(id) => void q.run(id)} onRemove={q.remove} />
            ) : (
              // ファイルを追加する前の画面（WeVocalSynth の EmptyState と同じ形）
              <Stack spacing={2} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <Box sx={{ color: 'text.secondary', fontSize: 40 }}>
                  <FontAwesomeIcon icon={faFileArrowUp} />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {t('empty.formats')}
                </Typography>
                <Button variant="contained" startIcon={<FontAwesomeIcon icon={faFolderOpen} />} onClick={openFiles}>
                  {t('empty.choose')}
                </Button>
              </Stack>
            )}
          </Box>
        </Box>

        <SettingsDialog open={settingsOpen} focusSignal={settingsFocus} onClose={() => setSettingsOpen(false)} settings={settings} onChange={updateSettings} notify={setToast} />
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
      </WindowModeContext.Provider>
      </PevenLabels.Provider>
    </LangContext.Provider>
  )
}
