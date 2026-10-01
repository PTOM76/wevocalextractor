import { createContext, useContext } from 'react'

/**
 * 多言語化（WeVocalSynth の src/i18n と同じ作り）。日本語を正とし、英語に欠けたキーがあると型エラーになる
 */
const ja = {
  'app.lead': '曲からボーカルと伴奏を取り出します。音声はサーバーへ送らず、ブラウザの中だけで処理します。',
  'common.close': '閉じる',
  'menu.file': 'ファイル',
  'menu.open': '開く…',
  'menu.saveVocals': 'ボーカルを保存',
  'menu.saveAccompaniment': '伴奏を保存',
  'menu.tools': 'ツール',
  'menu.extract': '取り出す',
  'menu.settings': '設定…',
  'menu.help': 'ヘルプ',
  'menu.shortcuts': 'ショートカット一覧',
  'menu.about': 'このアプリについて',
  'empty.formats': 'WAV / MP3 / M4A / MP4 などをドロップするか、ファイルを選んでください',
  'empty.choose': 'ファイルを選ぶ',
  'file.change': '別のファイル',
  'extract.run': '取り出す',
  'extract.cancel': '中止',
  'extract.note': '初回はモデルをダウンロードします（次回からは保存したものを使います）',
  'stage.decode': '読み込み中…',
  'stage.model': 'モデルを取得中… {p}%',
  'stage.init': 'モデルを準備中…',
  'stage.separate': '取り出し中… {p}%',
  'stem.vocals': 'ボーカル',
  'stem.accompaniment': '伴奏',
  'result.download': 'WAV で保存',
  'error.failed': '取り出せませんでした: {message}',
  'settings.title': '設定',
  'settings.cat.general': '全般',
  'settings.cat.extract': 'ボーカル抽出',
  'settings.cat.data': 'データ',
  'settings.groupAppearance': '外観',
  'settings.theme': 'テーマ',
  'settings.themeSystem': 'システムに合わせる',
  'settings.themeLight': 'ライト',
  'settings.themeDark': 'ダーク',
  'settings.language': '言語',
  'settings.languageAuto': '自動（ブラウザに合わせる）',
  'settings.groupUpdate': 'アップデート',
  'settings.groupExtract': 'ボーカル抽出',
  'settings.model': 'モデル',
  'settings.modelLight': '軽量（{mb}MB）',
  'settings.modelStandard': '標準（{mb}MB）',
  'settings.modelPrecise': '高精度（{mb}MB）',
  'settings.gpu': 'GPU（WebGPU）を使う',
  'settings.gpuHelp': '使えない環境や、軽量のモデルでは CPU で処理します',
  'settings.highBand': '高音域を残す',
  'settings.highBandHelp': 'モデルが扱わない約 11kHz より上を残します。伴奏の高い音が混ざりやすくなります',
  'settings.groupData': '保存したデータ',
  'data.models': 'ダウンロードしたモデル',
  'data.modelsHelp': '次回からダウンロードせずに使うため、ブラウザに保存しています',
  'data.delete': '削除',
  'data.deleteConfirm': '保存したモデルを削除しますか？次に取り出すときに、もう一度ダウンロードします。',
  'data.deleted': '保存したモデルを削除しました',
  'about.version': 'バージョン',
  'about.author': '作者',
  'about.license': 'ライセンス',
  'about.licenseText': 'MIT（モデルは Spleeter（MIT）を sherpa-onnx（Apache-2.0）が変換したもの）',
  'shortcuts.open': 'ファイルを開く',
  'shortcuts.drop': 'ファイルをドロップ',
  'shortcuts.dropDesc': 'ファイルを開く（画面のどこでも）',
  'shortcuts.menu': 'メニューバーに移る',
}

export type MessageKey = keyof typeof ja
export type Lang = 'ja_jp' | 'en_us'
export type LangSetting = 'auto' | Lang

const en: Record<MessageKey, string> = {
  'app.lead': 'Separate vocals and accompaniment from a song. Audio never leaves your browser.',
  'common.close': 'Close',
  'menu.file': 'File',
  'menu.open': 'Open…',
  'menu.saveVocals': 'Save vocals',
  'menu.saveAccompaniment': 'Save accompaniment',
  'menu.tools': 'Tools',
  'menu.extract': 'Extract',
  'menu.settings': 'Settings…',
  'menu.help': 'Help',
  'menu.shortcuts': 'Keyboard shortcuts',
  'menu.about': 'About',
  'empty.formats': 'Drop a WAV / MP3 / M4A / MP4 file, or choose one',
  'empty.choose': 'Choose a file',
  'file.change': 'Another file',
  'extract.run': 'Extract',
  'extract.cancel': 'Cancel',
  'extract.note': 'The model is downloaded the first time and reused afterwards',
  'stage.decode': 'Loading…',
  'stage.model': 'Downloading model… {p}%',
  'stage.init': 'Preparing model…',
  'stage.separate': 'Extracting… {p}%',
  'stem.vocals': 'Vocals',
  'stem.accompaniment': 'Accompaniment',
  'result.download': 'Save as WAV',
  'error.failed': 'Extraction failed: {message}',
  'settings.title': 'Settings',
  'settings.cat.general': 'General',
  'settings.cat.extract': 'Vocal extraction',
  'settings.cat.data': 'Data',
  'settings.groupAppearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.themeSystem': 'Follow system',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.language': 'Language',
  'settings.languageAuto': 'Auto (browser)',
  'settings.groupUpdate': 'Updates',
  'settings.groupExtract': 'Vocal extraction',
  'settings.model': 'Model',
  'settings.modelLight': 'Light ({mb} MB)',
  'settings.modelStandard': 'Standard ({mb} MB)',
  'settings.modelPrecise': 'Precise ({mb} MB)',
  'settings.gpu': 'Use GPU (WebGPU)',
  'settings.gpuHelp': 'Falls back to CPU when unavailable or with the light model',
  'settings.highBand': 'Keep high frequencies',
  'settings.highBandHelp': 'Keeps the band above ~11 kHz that the model ignores. Accompaniment highs may leak in',
  'settings.groupData': 'Saved data',
  'data.models': 'Downloaded models',
  'data.modelsHelp': 'Saved in the browser so they are not downloaded again',
  'data.delete': 'Delete',
  'data.deleteConfirm': 'Delete the saved models? They will be downloaded again the next time you extract.',
  'data.deleted': 'Saved models deleted',
  'about.version': 'Version',
  'about.author': 'Author',
  'about.license': 'License',
  'about.licenseText': 'MIT (the model is Spleeter (MIT) converted by sherpa-onnx (Apache-2.0))',
  'shortcuts.open': 'Open a file',
  'shortcuts.drop': 'Drop a file',
  'shortcuts.dropDesc': 'Open a file (anywhere on the page)',
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
