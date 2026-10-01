import { createContext, useContext } from 'react'

/**
 * 多言語化（WeVocalSynth の src/i18n と同じ作り）。日本語を正とし、英語に欠けたキーがあると型エラーになる
 */
const ja = {
  'common.close': '閉じる',
  'menu.file': 'ファイル',
  'menu.open': '開く…',
  'menu.add': '追加…',
  'menu.saveAll': 'すべて保存',
  'menu.runAll': 'すべて抽出',
  'menu.clear': '一覧を空にする',
  'opt.model': 'モデル',
  'opt.modelLight': '軽量',
  'opt.modelStandard': '標準',
  'opt.modelPrecise': '高精度',
  'opt.stems': '抽出するもの',
  'opt.format': '形式',
  'opt.formatWav': 'WAV',
  'opt.formatMp3': 'MP3',
  'opt.formatOpus': 'Opus',
  'settings.groupExport': '書き出し',
  'settings.wavFormat': 'WAV の形式',
  'settings.kbps': 'ビットレート（MP3 / Opus）',
  'opt.stemsBoth': 'ボーカルと伴奏',
  'opt.stemsVocals': 'ボーカル',
  'opt.stemsAccompaniment': '伴奏',
  'queue.add': '追加',
  'queue.runAll': 'すべて抽出',
  'queue.extract': '抽出',
  'queue.cancel': '中止',
  'queue.saveAll': 'すべて保存',
  'status.waiting': '待機中',
  'status.running': '抽出中 {p}%',
  'status.done': '完了',
  'status.error': '失敗',
  'item.play': '試聴',
  'item.stop': '停止',
  'item.position': '再生位置',
  'item.remove': '一覧から外す',
  'menu.tools': 'ツール',
  'menu.settings': '設定…',
  'menu.help': 'ヘルプ',
  'menu.shortcuts': 'ショートカット一覧',
  'menu.about': 'このアプリについて',
  'empty.formats': 'WAV / MP3 / MP4 など（ドラッグ＆ドロップ可）',
  'empty.choose': 'ファイルを選択',
  'stage.model': 'モデルを取得中… {p}%',
  'stage.init': 'モデルを準備中…',
  'stem.vocals': 'ボーカル',
  'stem.accompaniment': '伴奏',
  'error.failed': '抽出できませんでした: {message}',
  'error.modelMissing': 'モデルが見つかりません',
  'settings.title': '設定',
  'settings.cat.general': '全般',
  'settings.cat.extract': 'ボーカル抽出',
  'settings.cat.data': 'データ',
  'settings.cat.debug': '開発者向け',
  'settings.groupDebug': '開発者向け',
  'settings.dialogWindow': 'ダイアログの表示',
  'settings.auto': '自動',
  'settings.windowDialog': 'ダイアログ',
  'settings.windowPopup': 'ポップアップ',
  'settings.windowTab': '別タブ',
  'settings.windowSub': 'サブウィンドウ',
  'settings.groupAppearance': '外観',
  'settings.theme': 'テーマ',
  'settings.themeSystem': 'システムに合わせる',
  'settings.themeLight': 'ライト',
  'settings.themeDark': 'ダーク',
  'settings.language': '言語',
  'settings.languageAuto': '自動（ブラウザに合わせる）',
  'settings.groupUpdate': 'アップデート',
  'settings.groupExtract': 'ボーカル抽出',
  'settings.gpu': 'GPU（WebGPU）を使う',
  'settings.gpuHelp': '使えないときは CPU で処理します',
  'settings.highBand': '高音域を残す',
  'settings.highBandHelp': '約 11kHz より上を残す（伴奏が混ざりやすくなる）',
  'settings.groupData': '保存したデータ',
  'data.models': 'ダウンロードしたモデル',
  'data.modelsHelp': '次回からはダウンロードせずに使う',
  'data.delete': '削除',
  'data.deleteConfirm': '保存したモデルを削除しますか？',
  'data.deleted': '保存したモデルを削除しました',
  'about.version': 'バージョン',
  'about.author': '作者',
  'about.license': 'ライセンス',
  'about.licenseText': 'MIT（モデルは Spleeter（MIT）、MP3 の書き出しに LGPL-3.0 の lamejs を使用）',
  'shortcuts.open': 'ファイルを追加',
  'shortcuts.drop': 'ドロップ',
  'shortcuts.dropDesc': 'ファイルを追加',
  'shortcuts.menu': 'メニューバーに移る',
}

export type MessageKey = keyof typeof ja
export type Lang = 'ja_jp' | 'en_us'
export type LangSetting = 'auto' | Lang

const en: Record<MessageKey, string> = {
  'common.close': 'Close',
  'menu.file': 'File',
  'menu.open': 'Open…',
  'menu.add': 'Add…',
  'menu.saveAll': 'Save all',
  'menu.runAll': 'Extract all',
  'menu.clear': 'Clear list',
  'opt.model': 'Model',
  'opt.modelLight': 'Light',
  'opt.modelStandard': 'Standard',
  'opt.modelPrecise': 'Precise',
  'opt.stems': 'Stems',
  'opt.format': 'Format',
  'opt.formatWav': 'WAV',
  'opt.formatMp3': 'MP3',
  'opt.formatOpus': 'Opus',
  'settings.groupExport': 'Export',
  'settings.wavFormat': 'WAV format',
  'settings.kbps': 'Bitrate (MP3 / Opus)',
  'opt.stemsBoth': 'Vocals & accompaniment',
  'opt.stemsVocals': 'Vocals',
  'opt.stemsAccompaniment': 'Accompaniment',
  'queue.add': 'Add',
  'queue.runAll': 'Extract all',
  'queue.extract': 'Extract',
  'queue.cancel': 'Cancel',
  'queue.saveAll': 'Save all',
  'status.waiting': 'Waiting',
  'status.running': 'Extracting {p}%',
  'status.done': 'Done',
  'status.error': 'Failed',
  'item.play': 'Play',
  'item.stop': 'Stop',
  'item.position': 'Position',
  'item.remove': 'Remove from list',
  'menu.tools': 'Tools',
  'menu.settings': 'Settings…',
  'menu.help': 'Help',
  'menu.shortcuts': 'Keyboard shortcuts',
  'menu.about': 'About',
  'empty.formats': 'WAV / MP3 / MP4 etc. (drag & drop supported)',
  'empty.choose': 'Choose a file',
  'stage.model': 'Downloading model… {p}%',
  'stage.init': 'Preparing model…',
  'stem.vocals': 'Vocals',
  'stem.accompaniment': 'Accompaniment',
  'error.failed': 'Extraction failed: {message}',
  'error.modelMissing': 'Model not found',
  'settings.title': 'Settings',
  'settings.cat.general': 'General',
  'settings.cat.extract': 'Vocal extraction',
  'settings.cat.data': 'Data',
  'settings.cat.debug': 'Developer',
  'settings.groupDebug': 'Developer',
  'settings.dialogWindow': 'Dialog display',
  'settings.auto': 'Auto',
  'settings.windowDialog': 'Dialog',
  'settings.windowPopup': 'Popup',
  'settings.windowTab': 'New tab',
  'settings.windowSub': 'Sub-window',
  'settings.groupAppearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.themeSystem': 'Follow system',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.language': 'Language',
  'settings.languageAuto': 'Auto (browser)',
  'settings.groupUpdate': 'Updates',
  'settings.groupExtract': 'Vocal extraction',
  'settings.gpu': 'Use GPU (WebGPU)',
  'settings.gpuHelp': 'Falls back to CPU when unavailable',
  'settings.highBand': 'Keep high frequencies',
  'settings.highBandHelp': 'Keep above ~11 kHz (accompaniment may leak in)',
  'settings.groupData': 'Saved data',
  'data.models': 'Downloaded models',
  'data.modelsHelp': 'Reused without downloading again',
  'data.delete': 'Delete',
  'data.deleteConfirm': 'Delete the saved models?',
  'data.deleted': 'Saved models deleted',
  'about.version': 'Version',
  'about.author': 'Author',
  'about.license': 'License',
  'about.licenseText': 'MIT (model: Spleeter (MIT); MP3 export uses lamejs (LGPL-3.0))',
  'shortcuts.open': 'Add files',
  'shortcuts.drop': 'Drop',
  'shortcuts.dropDesc': 'Add files',
  'shortcuts.menu': 'Move to the menu bar',
}

const DICTS: Record<Lang, Record<MessageKey, string>> = { ja_jp: ja, en_us: en }

/** 表示中の言語。React の外（エラーメッセージなど）からも `t()` で使う */
let current: Lang = 'ja_jp'

/** 設定値から実際の言語を決める（auto はブラウザの言語に従う） */
export function resolveLang(setting: LangSetting): Lang {
  if (setting !== 'auto') return setting
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ja') ? 'ja_jp' : 'en_us'
}

export function setLang(lang: Lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'ja_jp' ? 'ja' : 'en'
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
