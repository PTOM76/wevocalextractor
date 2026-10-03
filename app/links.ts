// 外部へのリンク。移転したらここだけを変える（WeVocalSynth の src/links.ts と同じ形）

/** ユーザーガイド（ヘルプ → ユーザーガイド） */
export const USER_GUIDE_URL = 'https://github.com/PTOM76/wevocalextractor/blob/main/docs/MANUAL.md'

/** リンクをブラウザの新しいタブで開く（アプリの画面はそのまま残す） */
export const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')