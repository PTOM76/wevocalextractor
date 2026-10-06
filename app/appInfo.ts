// アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（使い方は appConfig.ts の app。WeVocalSynth と同じ形）
export const APP_INFO = {
  id: 'wevocalextractor',
  name: 'WeVocalExtractor',
  description: '曲からボーカルと伴奏を取り出す Web ツール',
  author: 'PitaQ',
  repository: 'https://github.com/PTOM76/wevocalextractor',
  // ユーザーガイド（ヘルプ → ユーザーガイド）。移転したらここだけを変える
  guide: 'https://github.com/PTOM76/wevocalextractor/blob/main/docs/MANUAL.md',
  site: 'https://wevocalextractor.pitan76.net/',
  lang: 'ja_jp',
}
