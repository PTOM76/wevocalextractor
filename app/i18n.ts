// 画面の文言（日本語と英語）。ブラウザの言語が日本語なら日本語、それ以外は英語

const ja = {
  title: 'WeVocalExtractor',
  lead: '曲からボーカルと伴奏を取り出します。音声はサーバーへ送らず、ブラウザの中だけで処理します。',
  open: 'ファイルを開く',
  drop: 'ここに音声ファイルをドロップ',
  formats: 'WAV / MP3 / M4A / MP4 など',
  change: '別のファイル',
  groupModel: 'モデル',
  model: '種類',
  modelLight: '軽量（{mb}MB）',
  modelStandard: '標準（{mb}MB）',
  modelPrecise: '高精度（{mb}MB）',
  gpu: 'GPU（WebGPU）を使う',
  gpuHelp: '使えない環境や、軽量のモデルでは CPU で処理します',
  highBand: '高音域を残す',
  highBandHelp: 'モデルが扱わない約 11kHz より上を残します。伴奏の高い音が混ざりやすくなります',
  extract: '取り出す',
  cancel: '中止',
  stageDecode: '読み込み中…',
  stageModel: 'モデルを取得中… {p}%',
  stageInit: 'モデルを準備中…',
  stageSeparate: '取り出し中… {p}%',
  vocals: 'ボーカル',
  accompaniment: '伴奏',
  download: 'WAV で保存',
  failed: '取り出せませんでした: {message}',
  clearModels: '保存したモデルを削除',
  cleared: '保存したモデルを削除しました',
  note: '初回はモデルをダウンロードします（次回からは保存したものを使います）',
}

const en: typeof ja = {
  title: 'WeVocalExtractor',
  lead: 'Separate vocals and accompaniment from a song. Audio never leaves your browser.',
  open: 'Open file',
  drop: 'Drop an audio file here',
  formats: 'WAV / MP3 / M4A / MP4 and more',
  change: 'Another file',
  groupModel: 'Model',
  model: 'Type',
  modelLight: 'Light ({mb} MB)',
  modelStandard: 'Standard ({mb} MB)',
  modelPrecise: 'Precise ({mb} MB)',
  gpu: 'Use GPU (WebGPU)',
  gpuHelp: 'Falls back to CPU when unavailable or with the light model',
  highBand: 'Keep high frequencies',
  highBandHelp: 'Keeps the band above ~11 kHz that the model ignores. Accompaniment highs may leak in',
  extract: 'Extract',
  cancel: 'Cancel',
  stageDecode: 'Loading…',
  stageModel: 'Downloading model… {p}%',
  stageInit: 'Preparing model…',
  stageSeparate: 'Extracting… {p}%',
  vocals: 'Vocals',
  accompaniment: 'Accompaniment',
  download: 'Save as WAV',
  failed: 'Extraction failed: {message}',
  clearModels: 'Delete saved models',
  cleared: 'Saved models deleted',
  note: 'The model is downloaded the first time and reused afterwards',
}

export type MessageKey = keyof typeof ja

const isJa = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ja')
const dict = isJa ? ja : en
if (typeof document !== 'undefined') document.documentElement.lang = isJa ? 'ja' : 'en'

/** 訳文を返す。`{name}` は `vars.name` で置き換える */
export function t(key: MessageKey, vars?: Record<string, string | number>) {
  const text = dict[key]
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}
