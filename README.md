# WeVocalExtractor
WeVocalExtractorは、Webブラウザ上で曲からボーカルと伴奏を取り出すための音源分離ツールである。

- https://wevocalextractor.pitan76.net/

インストール不要で、ブラウザだけでボーカルと伴奏を分けられる。<br />
音声ファイルはサーバーへ送らず、推論はすべてブラウザ内で行う。

画面を持たないライブラリとしても使え、[WeVocalSynth](https://github.com/PTOM76/wevocalsynth) のボーカル抽出もこれを使っている。

## できること
| 分類 | 機能 |
| --- | --- |
| 抽出 | 複数の曲をまとめて追加し、1曲ずつ順に取り出す（ボーカルと伴奏 / ボーカルだけ / 伴奏だけ）。曲ごとの進み具合と中止・やり直し |
| モデル | 軽量 / 標準 / 高精度の3種類から選択、初回に取得したモデルを保存して2回目から再利用、保存したモデルの削除 |
| 実行方法 | GPU（WebGPU）と CPU（WASM）。GPU が使えなければ CPU で処理する |
| 音質 | 約 11kHz より上の高音域を残すかどうかの選択 |
| 保存 | 曲ごとの試聴と保存（WAV / MP3 / Opus）、すべてを ZIP でまとめて保存 |
| その他 | PC/スマホ対応、オフライン利用（PWA）、ライト/ダーク、日本語/英語 |

## 技術スタック
| 項目 | 内容 |
| --- | --- |
| 画面 | React + TypeScript + MUI（[PevenMUI](https://github.com/PTOM76/pevenmui)、Vite） |
| 推論 | ONNX Runtime Web（Web Worker で実行） |
| モデル | Spleeter 2stems（[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) の ONNX 版） |
| 信号処理 | Rust → WebAssembly（STFT と逆STFT。[wevocal-lib](https://github.com/PTOM76/wevocal-lib) を使う） |

## セットアップ
```bash
git clone --recursive git@github.com:PTOM76/wevocalextractor.git
cd wevocalextractor
npm install
npm run fetch-models
npm run dev
```

`pevenmui/`（UI 部品）と `wevocal-lib/`（音声ファイルの読み込み・書き出し）は submodule。`--recursive` を付け忘れたら `git submodule update --init` で取得する。

モデルはリポジトリに含めない。`npm run fetch-models` で配布元から取得し、`public/models/` に置く（取得した配布物は `.cache/` に残る）。

信号処理（`dsp/`）を変えるときだけ Rust が要る。ビルド済みの `.wasm` をリポジトリに含めているので、画面だけなら Node.js だけで動く。

[Todofile](https://github.com/Pitan76/Todofile)を導入している場合は、クローン後、`todo setup` と `todo dev` で同様のセットアップが可能。

### WeVocalSynth の submodule として開発するとき
隣にある `../pevenmui`・`../wevocal-lib`（WeVocalSynth の submodule）を優先して使う（`vite.config.ts`、`tsconfig.app.json`）。
同じものが2か所に見えて違う方を直さないよう、こちらの `pevenmui/`・`wevocal-lib/` は取り出さずに隠しておく（`todo setup:nested`。中身は `git submodule deinit` と `git sparse-checkout`）。

## ライブラリとして使う
```ts
import { createExtractor } from 'wevocalextractor'

// vocals / accompaniment はモデル（ONNX）の ArrayBuffer
const ex = await createExtractor({ vocals, accompaniment, backend: 'wasm' })
const vocal = await ex.separate(channels, sampleRate, { stem: 'vocals', onProgress: (p) => {} })
ex.dispose()
```

- 入出力はチャンネルごとの `Float32Array` とサンプルレート。結果は入力と同じサンプルレート・チャンネル数・長さ
- 推論は専用の Worker で行う。モデルのサンプルレート（44.1kHz）・ステレオへの変換と戻しは `OfflineAudioContext` で行う
- ライブラリ本体（`src/`）は画面を持たず React も使わないので、ほかのアプリからもそのまま使える

## コードの場所
- 画面: `app/`
  - 組み立ては `app/App.tsx`、抽出の流れは `app/useExtract.ts`、モデルの取得と保存は `app/models.ts`
  - 言語: `app/i18n.ts`
- ライブラリ: `src/`
  - 公開 API は `src/index.ts`、推論は `src/worker.ts`
- 信号処理（Rust）: `dsp/src/`
- モデルの取得: `scripts/fetch-models.mjs`

## ドキュメント
| ドキュメント名 | リンク先 |
| --- | --- |
| 設計（方針・構成・公開 API・処理の流れ・実行方法） | [docs/DESIGN.md](docs/DESIGN.md) |
| モデル（種類・入出力・測った値・今後の候補） | [docs/MODELS.md](docs/MODELS.md) |
| 決定事項 | [docs/DECISIONS.md](docs/DECISIONS.md) |

## License
This project is licensed under the MIT License.

使っている部品とモデルのライセンスは [LICENSE-THIRD-PARTY.md](LICENSE-THIRD-PARTY.md)（全文は [licenses/](licenses/)）。
