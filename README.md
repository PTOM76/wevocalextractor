# WeVocalExtractor
曲からボーカル（または伴奏）を取り出すライブラリ。ブラウザの中で推論し、音声を外部に送らない。

<!-- 今は [WeVocalSynth](https://github.com/PTOM76/wevocalsynth) の submodule として、追加機能のビルドに使っている。将来は単体のツールとしても公開する。 -->

## 使い方
```ts
import { createExtractor } from 'wevocalextractor'

// vocals / accompaniment はモデル（ONNX）の ArrayBuffer
const ex = await createExtractor({ vocals, accompaniment, backend: 'wasm' })
const vocal = await ex.separate(channels, sampleRate, { stem: 'vocals', onProgress: (p) => {} })
ex.dispose()
```

- 入出力はチャンネルごとの `Float32Array` とサンプルレート。結果は入力と同じサンプルレート・チャンネル数・長さ
- 推論は専用の Worker で行う。モデルのサンプルレート（44.1kHz）・ステレオへの変換と戻しは `OfflineAudioContext` で行う

## モデル
Spleeter 2stems を [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) が ONNX に変換したもの（fp16 / int8 / fp32）。ボーカル用と伴奏用の2つを使う。

| 項目 | 値 |
| --- | --- |
| STFT | 44.1kHz、n_fft 4096、hop 1024、Hann 窓、center なし |
| 入力 | 振幅スペクトログラム `[2ch, 分割数, 512 フレーム, 1024 ビン]` |
| 後処理 | 比率のマスク `v² / (v² + a²)` を元の STFT に掛けて逆STFT |

fp16 版は ONNX Runtime Web 1.30 の WebGPU で出力がすべて 0 になるため、WASM で動かす。

## ファイル
| ファイル | 内容 |
| --- | --- |
| `src/index.ts` | 公開 API（`createExtractor`） |
| `src/worker.ts` | 推論の Worker。512 フレームずつ STFT → 推論 → マスク → 逆STFT |
| `src/stft.ts` | STFT / 逆STFT（後で wevocal-lib の Rust に移す） |
| `src/types.ts` | 型と Worker とのメッセージ |

## ドキュメント
詳しくは [docs/](docs/README.md)。
- [設計](docs/DESIGN.md): 方針・構成・公開 API・処理の流れ・実行方法
- [モデル](docs/MODELS.md): Spleeter 2stems の種類・入出力・測った値・今後の候補
