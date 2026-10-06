// 外部へのリンク（URL は appInfo.ts）
import { app } from './appConfig'

/** ユーザーガイド（ヘルプ → ユーザーガイド） */
export const USER_GUIDE_URL = app.guide

/** リンクをブラウザの新しいタブで開く（アプリの画面はそのまま残す） */
export const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')