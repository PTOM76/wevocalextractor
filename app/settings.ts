import { useState } from 'react'
import type { ExportFormat, WavFormat } from 'wevocal-lib'
import type { LangSetting } from './i18n'
import type { ModelKind } from './models'

export type ThemeSetting = 'system' | 'light' | 'dark'
/** 抽出するもの */
export type StemsSetting = 'both' | 'vocals' | 'accompaniment'

/** アプリの設定（localStorage に保存する） */
export interface Settings {
  theme: ThemeSetting
  language: LangSetting
  model: ModelKind
  /** GPU（WebGPU）を使ってよいか */
  gpu: boolean
  stems: StemsSetting
  /** 書き出す形式と、WAV のサンプル形式・MP3 / Opus のビットレート（kbps） */
  format: ExportFormat
  wavFormat: WavFormat
  kbps: number
  /** 約 11kHz より上を残す（モデルが扱わない帯域） */
  highBand: boolean
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', language: 'auto', model: 'int8', stems: 'both', format: 'wav', wavFormat: 'pcm16', kbps: 192, gpu: true, highBand: false }

const KEY = 'wevocalextractor.settings'

function load(): Settings {
  try {
    // 古い設定に無い項目は既定値で埋める
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** 設定と、一部を変えて保存する関数 */
export function useSettings() {
  const [settings, setSettings] = useState(load)
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // 保存できなくても、このセッション中は使う
      }
      return next
    })
  return [settings, update] as const
}
