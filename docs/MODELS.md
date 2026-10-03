# モデル
WeVocalExtractor で使うモデル（Spleeter 2stems）と、その入出力、測った値、今後の候補をまとめる。(2026-10-01 時点)
端末・ブラウザとの互換性（動かない組み合わせと、自動で替えるもの）は [COMPATIBILITY.md](COMPATIBILITY.md) に記録する。

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

## UVR の MDX-Net（追加の候補、2026-10-04 に調べた）
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) が、UVR（Ultimate Vocal Remover）の MDX-Net を ONNX にして配布している（28〜63MB、17 種類）。ボーカル用と伴奏用の 2 つを足す予定。

| 候補 | 大きさ | 出すもの | 用途 |
| --- | --- | --- | --- |
| `UVR-MDX-NET-Voc_FT` | 63MB | ボーカル | ボーカルを高品質に取り出す |
| `UVR-MDX-NET-Inst_HQ_4` | 56MB | 伴奏 | 伴奏を高品質に取り出す |

### ライセンス
UVR のコードは MIT。重みについて、UVR の README に「UVR's core developers trained all of the models provided in this package (except for the Demucs v3 and v4 4-stem models)」「For all third-party application developers who wish to use our models, please honor the MIT license by providing credit to UVR and its developers」とある（[ultimatevocalremovergui](https://github.com/Anjok07/ultimatevocalremovergui)）。Voc_FT・Inst_HQ_4 は UVR の開発者が学習させたものなので、MIT として、UVR と開発者のクレジットを付けて配る。モデルごとのライセンスファイルは無い。名前に Kim の付くモデル（Kim_Vocal など）は別の作者のもので、ライセンスがはっきりしないので使わない（[kmdx-net#3](https://github.com/KimberleyJensen/kmdx-net_music-source-separation/issues/3)）。

### 入出力（Spleeter との違い）
sherpa-onnx の実装（`offline-source-separation-uvr-impl.h`、`scripts/uvr_mdx/test.py`）から:

| 項目 | 内容 |
| --- | --- |
| 入力 `x` | 複素スペクトログラム `[分割数, 4, dim_f, dim_t]`。4 は左の実部・左の虚部・右の実部・右の虚部。dim_f は 3072 など、dim_t は 256 |
| 出力 | 同じ形の、取り出す音の複素スペクトログラム（マスクではない）。dim_f より上のビンは 0 |
| もう一方の音 | 元の音 − 取り出した音 |
| STFT | 44.1kHz、n_fft はモデルごと（6144・7680 など。2 のべき乗ではない）、hop 1024、Hann 窓、center あり |
| 区切り方 | 15 秒ずつ、前後 1 秒の余白。その中を `hop × (dim_t − 1) − n_fft` サンプルずつに分けて推論する |
| モデルごとの値 | ONNX のメタデータ（`n_fft`・`dim_f`・`dim_t`・`hop_length` など）。ブラウザの ONNX Runtime からは読めないので、こちらの表に書く |
| 速さ | CPU で Spleeter の約 10 倍遅い（sherpa-onnx の測定、28MB のモデルで RTF 0.73） |

組み込むには、2 のべき乗でない FFT（3・5 を含む大きさ）を dsp.wasm に足し、Worker に MDX-Net 用の処理を足す。
## 今後の候補
| 候補 | 所感 |
| --- | --- |
| UVR の MDX-Net 系 | sherpa-onnx に ONNX 版（28〜64MB）がある。Spleeter より約10倍遅い。重みのライセンスはモデルごとに確かめる |
| Demucs（htdemucs） | 高品質だが重い。スマホの標準には向かない |
