import { defineApp } from 'pevenmui/web'
import { APP_INFO } from './appInfo'

/** アプリの定義（名前、URL、保存のキー）。Worker からも読み込める */
export const app = defineApp(APP_INFO)
