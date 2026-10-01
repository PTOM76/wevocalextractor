import { Box, Button, Typography } from '@mui/material'
import { Check, Choice, Group, Row, SettingsDialog as PevenSettingsDialog, useConfirm, useHighlighter, type SettingsCategory } from 'pevenmui'
import { UpdateSection } from 'pevenmui/pwa'
import { useT, type LangSetting, type MessageKey } from './i18n'
import { clearModels, MODELS, type ModelKind } from './models'
import { DEFAULT_SETTINGS, type Settings, type ThemeSetting } from './settings'

type Category = 'general' | 'extract' | 'data'

/** 設定の検索の対象: 分類ごとのグループ名・項目名・説明文の訳文キー。項目を足したらここにも足す */
const INDEX: Record<Category, MessageKey[]> = {
  general: ['settings.groupAppearance', 'settings.theme', 'settings.language', 'settings.groupUpdate'],
  extract: ['settings.groupExtract', 'settings.model', 'settings.gpu', 'settings.gpuHelp', 'settings.highBand', 'settings.highBandHelp'],
  data: ['settings.groupData', 'data.models', 'data.modelsHelp'],
}

interface Props {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  notify: (message: string) => void
}

/** 保存したモデルの削除（設定の「データ」） */
function DataSection({ notify }: { notify: (message: string) => void }) {
  const t = useT()
  const hit = useHighlighter()
  const { confirm, dialog } = useConfirm()
  return (
    <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, width: 'fit-content', ...hit(t('data.models'), t('data.modelsHelp')) }}>{t('data.models')}</Typography>
        <Typography className="selectable" sx={{ fontSize: 11, color: 'text.secondary' }}>
          {t('data.modelsHelp')}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="outlined"
        color="error"
        onClick={async () => {
          if (!(await confirm({ message: t('data.deleteConfirm'), okLabel: t('data.delete'), danger: true }))) return
          await clearModels()
          notify(t('data.deleted'))
        }}
      >
        {t('data.delete')}
      </Button>
      {dialog}
    </Box>
  )
}

/** 設定画面（外枠は PevenMUI の SettingsDialog。WeVocalSynth と同じ形） */
export default function SettingsDialog({ open, onClose, settings, onChange, notify }: Props) {
  const t = useT()
  const categories: SettingsCategory<Category>[] = (Object.keys(INDEX) as Category[]).map((c) => ({
    id: c,
    label: t(`settings.cat.${c}`),
    texts: INDEX[c].map((k) => t(k)),
  }))
  return (
    <PevenSettingsDialog
      open={open}
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
                  options={[
                    ['auto', t('settings.languageAuto')],
                    ['ja_jp', '日本語'],
                    ['en_us', 'English'],
                  ]}
                />
              </Row>
            </Group>
            <Group title={t('settings.groupUpdate')}>
              <UpdateSection />
            </Group>
          </>
        ),
        extract: (
          <Group title={t('settings.groupExtract')}>
            <Row label={t('settings.model')}>
              <Choice<ModelKind>
                value={draft.model}
                onChange={(v) => set({ model: v })}
                options={[
                  ['fp16', t('settings.modelLight', { mb: MODELS.fp16.mb })],
                  ['int8', t('settings.modelStandard', { mb: MODELS.int8.mb })],
                  ['fp32', t('settings.modelPrecise', { mb: MODELS.fp32.mb })],
                ]}
              />
            </Row>
            <Check checked={draft.gpu} onChange={(v) => set({ gpu: v })} label={t('settings.gpu')} help={t('settings.gpuHelp')} />
            <Check checked={draft.highBand} onChange={(v) => set({ highBand: v })} label={t('settings.highBand')} help={t('settings.highBandHelp')} />
          </Group>
        ),
        data: (
          <Group title={t('settings.groupData')}>
            <DataSection notify={notify} />
          </Group>
        ),
      })}
    />
  )
}
