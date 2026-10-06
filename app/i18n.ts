import { createI18n } from 'pevenmui'
import ja from './lang/ja_jp.json'
import en from './lang/en_us.json'
import ko from './lang/ko_kr.json'
import zhCn from './lang/zh_cn.json'
import zhTw from './lang/zh_tw.json'

/**
 * 多言語化（PevenMUI の createI18n。WeVocalSynth の src/i18n と同じ作り）。訳文は lang/ の JSON。日本語を正とし、ほかの言語に欠けたキーがあると型エラーになる
 */
export const i18n = createI18n({
  base: 'ja_jp',
  fallback: 'en_us',
  messages: { ja_jp: ja, en_us: en, ko_kr: ko, zh_cn: zhCn, zh_tw: zhTw },
})

export type Lang = typeof i18n.Lang
export type LangSetting = 'auto' | Lang
export type MessageKey = typeof i18n.Key

/** 訳文を返す。React の外（エラーメッセージなど）からも使用できる */
export const { t, useT, LangContext } = i18n

/** 設定値から実際の言語を決める（auto はブラウザの言語に従う） */
export const resolveLang = i18n.resolve
export const setLang = i18n.setLang
