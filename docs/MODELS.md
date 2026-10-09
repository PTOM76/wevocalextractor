# モデル
WeVocalExtractor で使うモデル（Spleeter 2stems、UVR の MDX-Net、Demucs）と、その入出力、測った値、今後の候補をまとめる。(2026-10-01 時点)
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
ONNX Runtime Web 1.30 の WebGPU で fp16 版を動かすと、エラーにならずに出力がすべて 0 になった（入力は正しく渡っていた）。int8 版・fp32 版は WebGPU でも正しく抽出できた。

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

## UVR の MDX-Net（2026-10-04 に追加）
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) が、UVR（Ultimate Vocal Remover）の MDX-Net を ONNX にして配布している（28〜63MB、17 種類）。ボーカル用・伴奏用・主旋律用の 3 つを使う（モデルごとの値は [src/mdxModels.ts](../src/mdxModels.ts)）。

| 候補 | 大きさ | 出すもの | 用途 |
| --- | --- | --- | --- |
| `UVR-MDX-NET-Voc_FT` | 63MB | ボーカル | ボーカルを高品質に取り出す |
| `UVR-MDX-NET-Inst_HQ_4` | 56MB | 伴奏 | 伴奏を高品質に取り出す |
| `UVR_MDXNET_KARA_2` | 53MB | 主旋律以外（伴奏と和声） | 取り出したボーカルを主旋律とハモリに分ける。Synth の「主旋律、ハモリ、伴奏の 3 トラックに分離」で、ボーカル用のモデルのあとに掛ける。曲に直接掛けると伴奏が主旋律の側に残るので、このアプリのモデルの選択肢には出さない（2026-10-05 に追加） |

KARA_2 の値は UVR の設定（n_fft 5120、compensate 1.065、primary_stem は Instrumental）から。sherpa-onnx の ONNX はメタデータが足されていて UVR のハッシュと一致しないので、UVR の配布元（TRvlvr/model_repo）の元のファイルのハッシュで設定を引いた。ONNX のメタデータの dim_f は 2048、dim_t は 256（UVR の設定の dim_t 8 は 2 の 8 乗）。

### ライセンス
UVR のコードは MIT。重みについて、UVR の README に「UVR's core developers trained all of the models provided in this package (except for the Demucs v3 and v4 4-stem models)」「For all third-party application developers who wish to use our models, please honor the MIT license by providing credit to UVR and its developers」とある（[ultimatevocalremovergui](https://github.com/Anjok07/ultimatevocalremovergui)）。Voc_FT・Inst_HQ_4・KARA_2 は UVR の開発者が学習させたものなので、MIT として、UVR と開発者のクレジットを付けて配る。モデルごとのライセンスファイルは無い。名前に Kim の付くモデル（Kim_Vocal など）は別の作者のもので、ライセンスがはっきりしないので使わない（[kmdx-net#3](https://github.com/KimberleyJensen/kmdx-net_music-source-separation/issues/3)）。

### 入出力（Spleeter との違い）
sherpa-onnx の実装（`offline-source-separation-uvr-impl.h`、`scripts/uvr_mdx/test.py`）から:

| 項目 | 内容 |
| --- | --- |
| 入力 `x` | 複素スペクトログラム `[分割数, 4, dim_f, dim_t]`。4 は左の実部・左の虚部・右の実部・右の虚部。dim_f は 3072 など、dim_t は 256 |
| 出力 | 同じ形の、取り出す音の複素スペクトログラム（マスクではない）。dim_f より上のビンは 0 |
| もう一方の音 | 元の音 − 取り出した音 |
| STFT | 44.1kHz、n_fft はモデルごと（6144・7680 など。2 のべき乗ではない）、hop 1024、Hann 窓、center あり |
| 区切り方 | 15 秒ずつ、前後 1 秒の余白。その中を `hop × (dim_t − 1) − n_fft` サンプルずつに分けて推論する |
| モデルごとの値 | ONNX のメタデータ（`n_fft`・`dim_f`・`dim_t`・`hop_length` など）。ブラウザの ONNX Runtime からは読めないので、こちらの表に書く。sherpa-onnx の ONNX の `n_fft` は dim_f × 2 で書かれていて、Voc_FT は UVR の設定（7680）と違う（6144）。UVR の方を使う。取り出した音に掛ける補正（`compensate`）も UVR の設定から（Voc_FT 1.021、Inst_HQ_4 1.01） |
| 速さ | CPU で Spleeter の約 10 倍遅い（sherpa-onnx の測定、28MB のモデルで RTF 0.73） |

組み込み: 2 のべき乗でない FFT（3・5 を含む大きさ）を wevocal-lib に追加し、MDX-Net 用の STFT と逆変換を dsp.wasm（`dsp/src/mdx.rs`）に、区間ごとの推論を [src/mdx.ts](../src/mdx.ts) に配置した。曲の前後を `n_fft / 2` ずつ延ばし、`hop × (dim_t − 1)` サンプルの区間を `区間 − n_fft` ずつずらして推論し、区間の両端は捨ててつなぐ（sherpa-onnx の 15 秒ずつの区切りは、メモリを抑えるためのもので使っていない）。

測った値（2026-10-04、開発 PC の Chrome、5 秒の曲）:

| モデル | WebGPU | CPU（WASM、1 スレッド） |
| --- | --- | --- |
| Voc_FT | 3.0 秒（RTF 0.61。初回は準備に 6 秒） | 53 秒（RTF 10.5） |
| Inst_HQ_4 | 2.1 秒（RTF 0.43） | — |

CPU では曲の長さの約 10 倍かかるので、画面で知らせる（GPU を使わない設定や、WebGPU の無いブラウザ）。WebGPU の出力は CPU と同じで、0 になる問題は無かった。

速くする工夫（2026-10-09）:
- GPU が区間を推論している間に、前の区間の逆 STFT と次の区間の STFT を進める（[src/mdx.ts](../src/mdx.ts)）。CPU では推論も同じスレッドなので変わらない
- 入力の 1 つ目の次元（`batch_size`）は可変で、区間をまとめて推論できる。GPU では 2 区間ずつまとめる（`MDX_GPU_BATCH`）。CPU（Node、1 スレッド、Voc_FT）ではまとめても速くならなかった（1 区間 51 秒、2 区間 114 秒）ので、1 区間ずつのまま
- 並べ替えとまとめても、出力は 1 区間ずつと同じ（差 0）
- 👤 WebGPU での速さは未測定
## Demucs（2026-10-08 に追加）
Demucs v4（htdemucs、Meta）を ONNX にしたもの（[adowu/htdemucs-onnx](https://huggingface.co/adowu/htdemucs-onnx)、[adowu/htdemucs-6s-onnx](https://huggingface.co/adowu/htdemucs-6s-onnx)）。曲を楽器ごとに分ける。重みを fp16 で持つ版を使う（モデルごとの値は [src/demucsModels.ts](../src/demucsModels.ts)）。

| モデル | 大きさ | 出すもの（この順） |
| --- | --- | --- |
| `htdemucs_fp16weights` | 166MB | ドラム、ベース、その他、ボーカル |
| `htdemucs_6s_fp16weights` | 136MB | ドラム、ベース、その他、ボーカル、ギター、ピアノ |

fp32 版（316MB、258MB）は入れていない。出力の差は最大 4.6×10⁻⁵ で、実行時は fp16 版も fp32 で計算するので、メモリと速さも同じ（モデルカードの値）。楽器ごとに専用のモデルを使う高品質版（htdemucs_ft）は、4 つで 1.26GB、時間も 4 倍なので入れていない。

### ライセンス
Demucs はコードも学習済みの重みも MIT（[facebookresearch/demucs](https://github.com/facebookresearch/demucs)。2025-01 にアーカイブ）。UVR にも入っているが、UVR の開発者が学習させたものではない（UVR の README の「except for the Demucs v3 and v4 4-stem models」）。ONNX 版のモデルカードも MIT。

### 入出力

| 項目 | 内容 |
| --- | --- |
| 入力 `mix` | `[1, 2, 343980]`。44.1kHz ステレオの波形 7.8 秒（-1〜1） |
| 出力 `stems` | `[1, 音の数, 2, 343980]`。音ごとの波形 |
| STFT | モデルの中（sin、cos の重みの Conv1d にしてある）。dsp.wasm は使わない |
| 区切り方 | 1/4 ずつ重ねて 7.8 秒ずつ推論し、重なる所は直線で入れ替えて足す（[src/demucs.ts](../src/demucs.ts)。ONNX 版の `infer.py` と同じ。曲の頭と終わりは小さくしない） |
| 伴奏 | 元の音 − ボーカル（`accompaniment` を頼まれたとき）。モデルの出力の和は、元の音と -30dB 程度の差がある |

### ブラウザで動かすときの注意
- グラフの最適化を切る（`graphOptimizationLevel: 'disabled'`）。既定（all）でも basic でも、セッションを作るところで wasm のメモリが足りなくなる（`std::bad_alloc`）
- wasm のメモリの上限を 2GB にする（`DEMUCS_MEMORY_MB`。既定の 1GB では足りない）

測った値（2026-10-08、開発 PC、Node 22 + onnxruntime-web 1.30 の wasm、`htdemucs_fp16weights`）:

| 項目 | 1 スレッド | 4 スレッド |
| --- | --- | --- |
| 読み込み | 25 秒 | 18 秒 |
| 推論（7.8 秒の区切り 1 つ） | 36 秒 | 16 秒 |
| 曲の長さに対する時間（区切りは 5.85 秒ずつ進む） | 約 6 倍 | 約 2.7 倍（24 秒の曲で 65 秒） |
| メモリ（プロセス全体） | 1.2GB | 1.3GB |

GitHub Pages では COOP/COEP が無くマルチスレッドを使えないので、CPU では 1 スレッド（3 分の曲で約 18 分）。WebGPU の速さは未確認。
曲全体（24 秒）を分けて 4 つの音を足すと、元の音との差は -31.8dB だった。

## 今後の候補
| 候補 | 所感 |
| --- | --- |
| UVR の MDX-Net 系 | sherpa-onnx に ONNX 版（28〜64MB）がある。Spleeter より約10倍遅い。重みのライセンスはモデルごとに確かめる |
| htdemucs_ft | Demucs の高品質版。楽器ごとに 316MB のモデルが 4 つ。時間も 4 倍 |
| WebGPU 向けの htdemucs_6s（[kramp/htdemucs-6s-webgpu-onnx](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx)） | WebGPU で動くように作り直したもの。Demucs を速くしたいときの候補 |
