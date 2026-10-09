# 設計
WeVocalExtractor の方針、構成、公開 API、処理の流れ、実行方法をまとめる。使うモデルと測った値は [MODELS.md](MODELS.md)。(2026-10-01 時点)

## 方針
- **音源分離**（混ざった音から楽器ごとの音を推定して分けること）は、機械学習のモデルで行う。声と楽器は同じ周波数帯域に重なるため、EQ や FFT だけでは分けられない
- 分け方は「ボーカル / 伴奏」の2つで十分とする。4ステム（ボーカル・ドラム・ベース・その他）は要らない
- 評価の基準は「単体の分離ソフトとして最高品質か」ではなく、「後段の F0（基本周波数、声の高さ）解析とピッチ・時間の編集に十分なボーカルを、ブラウザで軽く作れるか」
- 推論は端末上で行い、音声を外部に送らない。静的ホスティングだけで動くようにするため
- スマホでも動くことを必須にする。そのため1曲を丸ごとではなく、少しずつ処理する（[処理の流れ](#処理の流れ)）

## 構成
ライブラリ（`src/`）と、それを使う Web ツール（`app/`）に分ける。ライブラリは画面を持たず、WeVocalSynth の追加機能など、ほかのアプリからもそのまま使う。

### ライブラリ
| ファイル | 内容 |
| --- | --- |
| `src/index.ts` | 公開 API（`createExtractor`）。モデルのサンプルレート・チャンネル数への変換と戻し |
| `src/worker.ts` | 推論の Worker。STFT → 推論 → マスク → 逆STFT |
| `src/dsp.wasm` | `dsp/` のビルド成果物（リポジトリに含める。Rust が無くても使用できるように） |
| `dsp/` | STFT（短時間フーリエ変換）と、マスクを掛けての逆STFT（Rust）。STFT 本体は [wevocal-lib](https://github.com/PTOM76/wevocal-lib) のもの。512 フレームのブロック単位で呼ぶ |
| `scripts/build-wasm.mjs` | `dsp/` を wasm にビルドして `src/dsp.wasm` にコピーする。`WEVOCAL_LIB_PATH` で手元の wevocal-lib に差し替えられる |
| `src/types.ts` | 型と、Worker とのメッセージ |

- ライブラリは UI を持たず、React などにも依存しない。受け渡しはチャンネルごとの `Float32Array` とサンプルレートだけにする。Web ツール（`app/`）からも、ほかのアプリからも同じように使用できるようにするため
- モデルファイルはリポジトリに含めない。使う側が取得して `ArrayBuffer` で渡す（[MODELS.md](MODELS.md) の配布元から取る）
- ONNX Runtime Web は `peerDependencies`。使う側がバンドルする

### Web ツール
| ファイル | 内容 |
| --- | --- |
| `app/App.tsx` | 画面の組み立て（上部のバー、操作の帯（モデル・取り出すもの・追加・すべて取り出す・すべて保存）、一覧、各ダイアログ） |
| `app/QueueList.tsx` | 取り出す曲の一覧。曲ごとの状態・進み具合・試聴・保存・やり直し・外す |
| `app/SettingsDialog.tsx` | 設定画面の中身（全般・ボーカル抽出の詳細（GPU・高音域）・データ）。モデルと取り出すものは、よく変えるので画面の操作の帯に配置する。外枠は PevenMUI の SettingsDialog |
| `app/settings.ts` | 設定（テーマ・言語・モデル・取り出すもの・GPU・高音域）。localStorage に保存する |
| `app/useQueue.ts` | 一覧の曲を1曲ずつ順に取り出す。モデルは最初に1回読み込み、一覧が終わるまで使い回す。中止は `dispose` で行い、途中の曲は待機中に戻す |
| `app/zip.ts` | 「すべて保存」用の無圧縮 ZIP |
| `app/models.ts` | モデルの種類と取得。取得したものは Cache Storage に保存し、2回目からはダウンロードしない |
| `app/i18n.ts` | 画面の文言（日本語・英語。設定の「言語」で切り替え、自動ならブラウザの言語） |
| `scripts/fetch-models.mjs` | 配るモデルを sherpa-onnx の配布物から取得し、`public/models/<種類>/` に配置する |
| `vite.config.ts` | ツールのビルド設定。PevenMUI は隣の `../pevenmui` があればそれを、なければ submodule の `pevenmui/` を使う |

- 音声ファイルの読み込みと書き出し（WAV / MP3 / Opus）は [wevocal-lib](https://github.com/PTOM76/wevocal-lib) の TypeScript 側（`web/`、submodule。WeVocalSynth と共通）
- 画面の部品は [PevenMUI](https://github.com/PTOM76/pevenmui)（MUI をもとにした UI 部品。WeVocalSynth と共通）。上部のバー・設定画面・このアプリについて・ショートカット一覧・更新の通知（`pevenmui/pwa`）もそこから使う
- PWA（vite-plugin-pwa）。新しい版は「更新」を押したときに切り替える。画面はオフライン用に保存し、モデルと ONNX Runtime の wasm（WebGPU 対応版 28MB、WASM 版 14MB）は `app/models.ts` が使ったものだけを保存する（Worker には `wasmUrl` で渡す）
- モデルは毎回読み込み、終わったら Worker ごと解放する（推論中は数百MB使うため、スマホでメモリを持ち続けない）
- 配信は GitHub Pages（`.github/workflows/deploy.yml`）。モデルもサイトと一緒に配る

## 公開 API
```ts
import { createExtractor } from 'wevocalextractor'

// vocals / accompaniment はモデル（ONNX）の ArrayBuffer。Worker に移すので、呼び出し元では使えなくなる
const ex = await createExtractor({ vocals, accompaniment, backend: 'wasm' }) // 'wasm' | 'webgpu'
const vocal = await ex.separate(channels, sampleRate, {
  stem: 'vocals', // 'vocals' | 'accompaniment'
  highBand: 'zeros', // 約 11kHz より上: 'zeros'（0 にする）| 'edge'（1024 ビン目のマスクで延ばす）
  onProgress: (p) => {}, // 0〜1
})
ex.dispose() // Worker を止める（モデルのメモリも解放される）。処理中の separate は AbortError で失敗する（中断に使用できる）
```

- 結果は入力と同じサンプルレート・チャンネル数・長さ
- `separate` は何度でも呼べる。終わったら `dispose` する（推論中は数百MB使うので、使わないときに持ち続けない）

## 処理の流れ
```text
入力（任意のサンプルレート・チャンネル数）
 → 44.1kHz・ステレオに変換（OfflineAudioContext）
 → 前後に N_FFT（4096 サンプル）ずつ無音を加える（両端のフレームも窓の重なりを揃えるため）
 → 512 フレーム（約 12 秒）ずつ:
     STFT → 振幅をモデルに入力（ボーカル用・伴奏用の2つ）
     → 比率のマスク v² / (v² + a²) を元の STFT に掛ける → 逆STFT して足し込む
 → 窓の2乗の和で割る → 加えた無音を切り取る
 → 元のサンプルレート・チャンネル数に戻す
```

- 512 フレームずつにするのは、1曲分のスペクトルを一度にメモリに載せないため（スマホではタブが落ちる）。ブロックごとに進捗を通知する
- ブロックは重ねずに区切る（sherpa-onnx の実装と同じ）。継ぎ目が気になったら、重ねてクロスフェードする方式を試す
- STFT の設定（44.1kHz、n_fft 4096、hop 1024、Hann 窓、center なし）はモデルの学習時と同じにする。違うと品質が崩れる
- モノラルの入力はステレオに広げて処理し、出力は平均してモノラルに戻す

## 実行方法
| 実行方法 | 扱い |
| --- | --- |
| WebGPU | 使用できる環境で、モデルが対応していれば使う（どちらを使うかは使う側が決める） |
| WASM（マルチスレッド） | 当面は使わない。COOP/COEP ヘッダーが要り、GitHub Pages などでは設定できない |
| WASM（シングルスレッド） | どこでも動く。動作保証の最低線 |

`numThreads` は 1 に固定している。

## 今後
- `separate` に `AbortSignal` を渡せるようにする（今は `dispose` で中断する）
- Rust に移した STFT の速さを測る（JS のときは処理時間の約4割を占めていた）
- ツールでの読み込み・WAV の書き出しを wevocal-lib の TypeScript 側に移し、WeVocalSynth と共通にする
- ツールのオフライン利用（PWA）
- WASM のマルチスレッドを使うか
