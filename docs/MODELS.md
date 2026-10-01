# モデル
WeVocalExtractor で使うモデル（Spleeter 2stems）と、その入出力、測った値、今後の候補をまとめる。(2026-10-01 時点)

## Spleeter 2stems（sherpa-onnx の ONNX 版）
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) が ONNX に変換して配布しているものを、そのまま使う。変換の作業（Python・TensorFlow）は要らない。

| 種類 | 大きさ（ボーカル用＋伴奏用） | WebGPU | 所感 |
| --- | --- | --- | --- |
| fp16 | 38MB | ✗（出力がすべて 0 になる） | ダウンロードが一番小さい |
| int8 | 50MB | ✓ | WASM でも fp16 より約1割速い。標準に向く |
| fp32 | 75MB | ✓ | 量子化なし |

- fp16 / int8 / fp32 は同じモデルの数値の精度（量子化の種類）の違い。int8 が fp16 より大きいのは配布物の作りによる
- ファイル名は配布物では `vocals.fp16.onnx` などだが、使う側で名前をそろえてよい
- ライセンス（sherpa-onnx: Apache-2.0、Spleeter: MIT）

### 入出力
| 項目 | 内容 |
| --- | --- |
| 入力 `x` | 振幅スペクトログラム `[2ch, 分割数, 512 フレーム, 1024 ビン]`（float32） |
| 出力 `y` | 同じ形。ボーカル用・伴奏用それぞれの推定 |
| 後処理 | 比率のマスク `(v² + ε/2) / (v² + a² + ε)` を元の STFT（複素数）に掛けて逆STFT |
| STFT | 44.1kHz、n_fft 4096、hop 1024、Hann 窓、center なし |

1024 ビン（約 11kHz）より上はモデルが扱わない。sherpa-onnx はマスクを 0 にしている（`highBand: 'zeros'`）。1024 ビン目のマスクで延ばす方法（`'edge'`）も選べるが、どちらがよいかは未定。

### fp16 は WebGPU で動かさない
ONNX Runtime Web 1.30 の WebGPU で fp16 版を動かすと、エラーは出ずに出力がすべて 0 になった（入力は正しく渡っていた）。int8 版・fp32 版は WebGPU でも正しく抽出できた。

## 測った値 (2026-10-01、PC・Chrome・1スレッド、45秒の曲)
| 構成 | RTF（処理時間 ÷ 音声の長さ） | 推論 | STFT＋逆STFT（JS） |
| --- | --- | --- | --- |
| fp16 / WASM | 0.19〜0.21 | 約5秒 | 約3.6秒 |
| int8 / WASM | 0.17〜0.18 | 約4.5秒 | 約3.4秒 |
| fp16 / WebGPU | 0.09（ただし出力がすべて 0） | 0.3秒 | 約3.7秒 |

- 1回の推論（512 フレーム ≒ 12 秒分）は、Node の CPU で fp16 が 116ms、int8 が 169ms だった。ブラウザ（WASM）では逆に int8 の方が速かった
- 2分の曲は fp16 / WASM で約23秒、JS ヒープ約210MB（ほとんどは出力のボーカル・伴奏 2ch ずつ）
- 音質は「後段の加工に十分」（聴いた印象）
- スマホでの速さ、int8 / fp32 の WebGPU での速さは未測定
- 測った確認ページは、WeVocalSynth の履歴（`experiments/vocal-extractor/`、コミット bf5b964 まで）にある

## 今後の候補
| 候補 | 所感 |
| --- | --- |
| UVR の MDX-Net 系 | sherpa-onnx に ONNX 版（28〜64MB）がある。Spleeter より約10倍遅い。重みのライセンスはモデルごとに確かめる |
| Demucs（htdemucs） | 高品質だが重い。スマホの標準には向かない |
