import { useEffect, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { Check, Choice, Group, LANG_NAMES, Row, SettingsDialog as PevenSettingsDialog, useConfirm, useHighlighter, type SettingsCategory, type WindowMode } from 'pevenmui'
import { UpdateSection } from 'pevenmui/pwa'
import type { WavFormat } from 'wevocal-lib'
import { useT, type LangSetting, type MessageKey } from './i18n'
import Diagnose from './Diagnose'
import { clearModels } from './models'
import { clearQueue, queueSize, type KeepMode } from './persist'
import { DEFAULT_SETTINGS, type Settings, type ThemeSetting } from './settings'

type Category = 'general' | 'extract' | 'data' | 'debug'

/** 設定の検索の対象: 分類ごとのグループ名・項目名・説明文の訳文キー。項目を足したらここにも足す */
const INDEX: Record<Category, MessageKey[]> = {
  general: ['settings.groupAppearance', 'settings.theme', 'settings.language', 'settings.groupUpdate'],
  extract: ['settings.groupExport', 'settings.wavFormat', 'settings.kbps', 'settings.groupExtract', 'settings.gpu', 'settings.gpuHelp', 'settings.highBand', 'settings.highBandHelp'],
  data: ['settings.groupData', 'data.models', 'data.modelsHelp', 'data.queue', 'settings.keepQueue', 'settings.keepQueueHelp'],
  debug: ['settings.groupDebug', 'settings.dialogWindow', 'settings.diagnose', 'settings.diagnoseHelp'],
}

interface Props {
  open: boolean
  onClose: () => void
  /** 変わるたびに、別の窓で開いている設定画面を手前に出す */
  focusSignal?: number
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  notify: (message: string) => void
}

/** 保存したデータの1行（名前・説明と削除ボタン。確かめてから消す） */
function DataRow(p: { label: string; help: string; confirmMessage: string; onDelete: () => Promise<void>; notify: (message: string) => void }) {
  const t = useT()
  const hit = useHighlighter()
  const { confirm, dialog } = useConfirm()
  return (
    <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, width: 'fit-content', ...hit(p.label, p.help) }}>{p.label}</Typography>
        <Typography className="selectable" sx={{ fontSize: 11, color: 'text.secondary' }}>
          {p.help}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="outlined"
        color="error"
        onClick={async () => {
          if (!(await confirm({ message: p.confirmMessage, okLabel: t('data.delete'), danger: true }))) return
          await p.onDelete()
          p.notify(t('data.deleted'))
        }}
      >
        {t('data.delete')}
      </Button>
      {dialog}
    </Box>
  )
}

/** 保存したデータ（設定の「データ」）: モデルと、閉じたあとも残した一覧 */
function DataSection({ notify }: { notify: (message: string) => void }) {
  const t = useT()
  // 残した一覧の大きさ（開いたとき・消したときに数え直す）
  const [queueBytes, setQueueBytes] = useState<number | null>(null)
  useEffect(() => void queueSize().then(setQueueBytes), [])
  const mb = queueBytes === null ? '…' : (queueBytes / 2 ** 20).toFixed(1)
  return (
    <>
      <DataRow label={t('data.models')} help={t('data.modelsHelp')} confirmMessage={t('data.deleteConfirm')} onDelete={clearModels} notify={notify} />
      <DataRow
        label={t('data.queue')}
        help={t('data.queueHelp', { mb })}
        confirmMessage={t('data.queueConfirm')}
        onDelete={async () => {
          await clearQueue()
          setQueueBytes(0)
        }}
        notify={notify}
      />
    </>
  )
}

/** 設定画面（外枠は PevenMUI の SettingsDialog。WeVocalSynth と同じ形） */
export default function SettingsDialog({ open, onClose, settings, onChange, notify, focusSignal }: Props) {
  const t = useT()
  const categories: SettingsCategory<Category>[] = (Object.keys(INDEX) as Category[]).map((c) => ({
    id: c,
    label: t(`settings.cat.${c}`),
    texts: INDEX[c].map((k) => t(k)),
  }))
  return (
    <PevenSettingsDialog
      open={open}
      focusSignal={focusSignal}
      onClose={onClose}
      title={t('settings.title')}
      settings={settings}
      defaults={DEFAULT_SETTINGS}
      onChange={onChange}
      categories={categories}
      pages={(draft, set) => ({
        general: (
          <>
            <Group title={t('settings.groupAppearance')}>
              <Row label={t('settings.theme')}>
                <Choice<ThemeSetting>
                  value={draft.theme}
                  onChange={(v) => set({ theme: v })}
                  options={[
                    ['system', t('settings.themeSystem')],
                    ['light', t('settings.themeLight')],
                    ['dark', t('settings.themeDark')],
                  ]}
                />
              </Row>
              <Row label={t('settings.language')}>
                <Choice<LangSetting>
                  value={draft.language}
                  onChange={(v) => set({ language: v })}
                  options={[['auto', t('settings.languageAuto')], ...LANG_NAMES]}
                />
              </Row>
            </Group>
            <Group title={t('settings.groupUpdate')}>
              <UpdateSection />
            </Group>
          </>
        ),
        extract: (
          <>
          <Group title={t('settings.groupExport')}>
            <Row label={t('settings.wavFormat')}>
              <Choice<WavFormat>
                value={draft.wavFormat}
                onChange={(v) => set({ wavFormat: v })}
                options={[
                  ['pcm16', '16bit'],
                  ['pcm24', '24bit'],
                  ['float32', '32bit float'],
                ]}
              />
            </Row>
            <Row label={t('settings.kbps')}>
              <Choice<string>
                value={String(draft.kbps)}
                onChange={(v) => set({ kbps: Number(v) })}
                options={['128', '192', '256', '320'].map((k): [string, string] => [k, `${k} kbps`])}
              />
            </Row>
          </Group>
          <Group title={t('settings.groupExtract')}>
            <Check checked={draft.gpu} onChange={(v) => set({ gpu: v })} label={t('settings.gpu')} help={t('settings.gpuHelp')} />
            <Check checked={draft.highBand} onChange={(v) => set({ highBand: v })} label={t('settings.highBand')} help={t('settings.highBandHelp')} />
          </Group>
          </>
        ),
        data: (
          <Group title={t('settings.groupData')}>
            <Row label={t('settings.keepQueue')} help={t('settings.keepQueueHelp')}>
              <Choice<KeepMode>
                value={draft.keepQueue}
                onChange={(v) => set({ keepQueue: v })}
                options={[
                  ['undownloaded', t('settings.keepUndownloaded')],
                  ['all', t('settings.keepAll')],
                  ['none', t('settings.keepNone')],
                ]}
              />
            </Row>
            <DataSection notify={notify} />
          </Group>
        ),
        debug: (
          <Group title={t('settings.groupDebug')}>
            <Row label={t('settings.dialogWindow')}>
              <Choice<WindowMode | 'auto'>
                value={draft.dialogWindow}
                onChange={(v) => set({ dialogWindow: v })}
                options={[
                  ['auto', t('settings.auto')],
                  ['dialog', t('settings.windowDialog')],
                  ['nativeDialog', '<dialog>'],
                  ['popover', 'Popover API'],
                  ['popup', t('settings.windowPopup')],
                  ['tab', t('settings.windowTab')],
                  ['window', t('settings.windowSub')],
                  ['pip', 'PiP'],
                ]}
              />
            </Row>
            <Diagnose settings={draft} />
          </Group>
        ),
      })}
    />
  )
}
