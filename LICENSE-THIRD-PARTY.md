# Third-party notices
WeVocalExtractor は MIT ライセンスで公開している。以下の部品とモデルは別のライセンスに従う。ライセンスの全文は [licenses/](licenses/) にある。

WeVocalExtractor のリポジトリには、モデルのファイルは含まない。モデルを配るとき（WeVocalSynth の追加機能など）は、ここに書いたライセンスの全文も一緒に配ること。

## ONNX Runtime Web（onnxruntime-web）
- 用途: 推論（`peerDependencies`。使う側がバンドルする）
- ライセンス: MIT（Copyright (c) Microsoft Corporation）。全文: [licenses/onnxruntime-MIT.txt](licenses/onnxruntime-MIT.txt)
- 配布元: https://github.com/microsoft/onnxruntime

## Spleeter 2stems の学習済みモデル（sherpa-onnx の ONNX 版）
- 用途: ボーカル / 伴奏の分離のモデル（[docs/MODELS.md](docs/MODELS.md)）
- 元のモデル: Spleeter（Deezer）。https://github.com/deezer/spleeter
  - コードのライセンス: MIT（Copyright (c) 2019-present, Deezer SA.）。全文: [licenses/spleeter-MIT.txt](licenses/spleeter-MIT.txt)
  - 学習済みモデルは同じリポジトリの Releases で配られており、個別のライセンスの記載はない。リポジトリのライセンス（MIT）に従うものとして扱っている (2026-10-01 時点の確認)
- ONNX への変換: sherpa-onnx（k2-fsa）。https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models
  - リポジトリのライセンス: Apache-2.0。全文: [licenses/sherpa-onnx-Apache-2.0.txt](licenses/sherpa-onnx-Apache-2.0.txt)
  - 変換したモデルの配布ページにも、個別のライセンスの記載はない (2026-10-01 時点の確認)

Spleeter の README は、著作権のある音源に使うときは権利者の許可を得るよう求めている。

## lamejs（@breezystack/lamejs）
- 用途: MP3 の書き出し
- ライセンス: LGPL-3.0（全文は `node_modules/@breezystack/lamejs/LICENSE`、配布元 https://github.com/nicktindall/lamejs の派生）
- 組み込み方: MP3 を書き出すときだけ読み込む Worker（`assets/mp3Worker-*.js`）に入れ、Web ツールだけが使う（ライブラリの `src/` は使わない）。このファイルを差し替えれば、改変したエンコーダを使える

MP3 以外（WAV / Opus）の書き出しと、アプリのほかの部分は lamejs に依存しない。
