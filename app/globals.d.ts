/** ビルド時に package.json の version が入る（vite.config.ts の define） */
declare const __APP_VERSION__: string
/** ビルドしたコミットの短いハッシュ（手元で git が使えなければ dev） */
declare const __APP_COMMIT__: string
