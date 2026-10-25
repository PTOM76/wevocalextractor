# WeVocalExtractor ドキュメント

## 使う人向け
- [使い方](MANUAL.md)（利用者向けの操作説明）
- [端末との互換性](COMPATIBILITY.md)（うまく動かない端末・ブラウザと対応）

## 設計
- [設計](DESIGN.md)（方針、構成（ライブラリと Web ツール）、公開 API、処理の流れ、実行方法）
- [モデル](MODELS.md)（Spleeter 2stems の種類、入出力、測った値、今後の候補）
- [決定事項](DECISIONS.md)（実装で問題を踏んで決まったこと。新しいコードでも同じようにする）

## 開発する人向け
セットアップと使用できるコマンドは [README](../README.md#セットアップ) と [todofile.json5](../todofile.json5)。

## wiki
`docs/wiki/` のページ（`start.md` 以外）は `npm run docs:wiki` が [MANUAL.md](MANUAL.md) から作る。手で書き換えない。MANUAL.md に `##` の見出しを足したら、`scripts/docs-to-dokuwiki.mjs` の `PAGES` にどのページへ入れるかを足す（足さないとスクリプトが止まる）。
