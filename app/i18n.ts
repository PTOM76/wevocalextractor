import { createContext, useContext } from 'react'
import { detectLang, HTML_LANG, type PevenLang } from 'pevenmui'
import ja from './lang/ja_jp.json'
import en from './lang/en_us.json'
import ko from './lang/ko_kr.json'
import zhCn from './lang/zh_cn.json'
import zhTw from './lang/zh_tw.json'

/**
 * 多言語化（WeVocalSynth の src/i18n と同じ作り）。訳文は lang/ の JSON。日本語を正とし、ほかの言語に欠けたキーがあると型エラーになる
 */
export type MessageKey = keyof typeof ja
export type Lang = PevenLang
export type LangSetting = 'auto' | Lang

const DICTS: Record<Lang, Record<MessageKey, string>> = {
  ja_jp: ja,
  en_us: en satisfies Record<MessageKey, string>,
  ko_kr: ko satisfies Record<MessageKey, string>,
  zh_cn: zhCn satisfies Record<MessageKey, string>,
  zh_tw: zhTw satisfies Record<MessageKey, string>,
}

/** 表示中の言語。React の外（エラーメッセージなど）からも `t()` で使う */
let current: Lang = 'ja_jp'

/** 設定値から実際の言語を決める（auto はブラウザの言語に従う） */
export function resolveLang(setting: LangSetting): Lang {
  if (setting !== 'auto') return setting
  return detectLang()
}

export function setLang(lang: Lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[lang]
}

/** 訳文を返す。`{name}` は `vars.name` で置き換える */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? ja[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/** 画面を言語の切り替えに追従させるための context */
export const LangContext = createContext<Lang>('ja_jp')

/** 画面部品用の `t`。言語が変わると呼び出し元が再描画される */
export function useT() {
  useContext(LangContext)
  return t
}
