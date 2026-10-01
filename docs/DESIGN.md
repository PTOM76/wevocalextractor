# 設計
WeVocalExtractor の方針、構成、公開 API、処理の流れ、実行方法をまとめる。使うモデルと測った値は [MODELS.md](MODELS.md)。(2026-10-01 時点)

## 方針
- **音源分離**（混ざった音から楽器ごとの音を推定して分けること）は、機械学習のモデルで行う。声と楽器は同じ周波数帯域に重なるため、EQ や FFT だけでは分けられない
- 分け方は「ボーカル / 伴奏」の2つで十分とする。4ステム（ボーカル・ドラム・ベース・その他）は要らない
- 評価の基準は「単体の分離ソフトとして最高品質か」ではなく、「後段の F0（基本周波数、声の高さ）解析とピッチ・時間の編集に十分なボーカルを、ブラウザで軽く作れるか」
- 推論は端末上で行い、音声を外部に送らない。静的ホスティングだけで動くようにするため
- スマホでも動くことを必須にする。そのため1曲を丸ごとではなく、少しずつ処理する（[処理の流れ](#処理の流れ)）

## 構成
| ファイル | 内容 |
| --- | --- |
| `src/index.ts` | 公開 API（`createExtractor`）。モデルのサンプルレート・チャンネル数への変換と戻し |
| `src/worker.ts` | 推論の Worker。STFT → 推論 → マスク → 逆STFT |
| `src/stft.ts` | STFT（短時間フーリエ変換）/ 逆STFT |
| `src/types.ts` | 型と、Worker とのメッセージ |

- UI を持たず、React などにも依存しない。受け渡しはチャンネルごとの `Float32Array` とサンプルレートだけにする。将来、単体のツールにしても、ほかのアプリに組み込んでもそのまま使えるようにするため
- モデルファイルはリポジトリに含めない。使う側が取得して `ArrayBuffer` で渡す（[MODELS.md](MODELS.md) の配布元から取る）
- ONNX Runtime Web は `peerDependencies`。使う側がバンドルする

## 公開 API
```ts
import { createExtractor } from 'wevocalextractor'

// vocals / accompaniment はモデル（ONNX）の ArrayBuffer。Worker に移すので、呼び出し元では使えなくなる
const ex = await createExtractor({ vocals, accompaniment, backend: 'wasm' }) // 'wasm' | 'webgpu'
const vocal = await ex.separate(channels, sampleRate, {
  stem: 'vocals', // 'vocals' | 'accompaniment'
  highBand: 'zeros', // 約 11kHz より上: 'zeros'（消す）| 'edge'（1024 ビン目のマスクで延ばす）
  onProgress: (p) => {}, // 0〜1
})
ex.dispose() // Worker を止める（モデルのメモリも解放される）
```

- 結果は入力と同じサンプルレート・チャンネル数・長さ
- `separate` は何度でも呼べる。終わったら `dispose` する（推論中は数百MB使うので、使わないときに持ち続けない）

## 処理の流れ
```text
入力（任意のサンプルレート・チャンネル数）
 → 44.1kHz・ステレオに変換（OfflineAudioContext）
 → 前後に N_FFT（4096 サンプル）ずつ無音を足す（両端のフレームも窓の重なりを揃えるため）
 → 512 フレーム（約 12 秒）ずつ:
     STFT → 振幅をモデルに入力（ボーカル用・伴奏用の2つ）
     → 比率のマスク v² / (v² + a²) を元の STFT に掛ける → 逆STFT して足し込む
 → 窓の2乗の和で割る → 足した無音を切り取る
 → 元のサンプルレート・チャンネル数に戻す
```

- 512 フレームずつにするのは、1曲分のスペクトルを一度にメモリに載せないため（スマホではタブが落ちる）。ブロックごとに進捗を通知する
- ブロックは重ねずに区切る（sherpa-onnx の実装と同じ）。継ぎ目が気になったら、重ねてクロスフェードする方式を試す
- STFT の設定（44.1kHz、n_fft 4096、hop 1024、Hann 窓、center なし）はモデルの学習時と同じにする。違うと品質が崩れる
- モノラルの入力はステレオに広げて処理し、出力は平均してモノラルに戻す

## 実行方法
| 実行方法 | 扱い |
| --- | --- |
| WebGPU | 使える環境で、モデルが対応していれば使う（どちらを使うかは使う側が決める） |
| WASM（マルチスレッド） | 当面は使わない。COOP/COEP ヘッダーが要り、GitHub Pages などでは設定できない |
| WASM（シングルスレッド） | どこでも動く。動作保証の最低線 |

`numThreads` は 1 に固定している。

## 今後
- STFT / 逆STFT を [wevocal-lib](https://github.com/PTOM76/wevocal-lib)（Rust、SIMD）に移す。JS の今は処理時間の約4割を占める
- 中断（`AbortSignal`）に対応する
- 単体で試せるデモページと、将来の GUI
- WASM のマルチスレッドを使うか
