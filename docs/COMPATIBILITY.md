# 端末との互換性
モデルと計算の種類（WASM / WebGPU）が、どの端末・ブラウザでうまく動かないかを記録する。見つけたら表に足し、自動で別のモデルに替えるもの（[src/compat.ts](../src/compat.ts) の表）も合わせて直す。

モデルそのものの説明は [MODELS.md](MODELS.md)、そうした決め事の理由は [DECISIONS.md](DECISIONS.md) を参照。調べるときは、設定の「開発者向け」→「抽出の診断」の結果を貼る。

## 分かっていること

| 端末・ブラウザ | モデル | 計算 | 結果 | 対応 | 日付 |
| --- | --- | --- | --- | --- | --- |
| PC・Chrome（ONNX Runtime Web 1.30） | fp16 | WebGPU | エラーは出ずに出力がすべて 0 | fp16 は常に WASM で動かす | 2026-10-01 |
| iPad（iPadOS、Safari 26.6、PWA） | すべて | すべて | 実行環境を作り直すと `RangeError: Out of memory`（no available backend found） | wasm のメモリの上限を 1GB に下げる（DECISIONS.md） | 2026-10-03 |
| iPad（iPadOS、Safari 26.6、PWA） | fp16 | WASM（fp16 は WebGPU を使わない） | 抽出のあと（トラックに分けた直後など）にタブが落ちる | CPU では WebGPU を含まない版を使う（下の節） | 2026-10-03 |
| iPad（iPadOS、Safari 26.6、PWA） | int8・fp32 | WebGPU | 抽出できる | — | 2026-10-03 |
| PC・Chrome | UVR の MDX-Net（Voc_FT・Inst_HQ_4） | WebGPU | 抽出できる（RTF 0.4〜0.6） | — | 2026-10-04 |
| PC・Chrome | UVR の MDX-Net | WASM | 抽出できるが、曲の長さの約 10 倍かかる | 画面で知らせる | 2026-10-04 |
| PC・Chrome 154（Windows、GTX 1050 Ti） | UVR の MDX-Net | WebGPU | 前日は抽出できたが、翌日はこのサイトの `requestAdapter()` が null になり、黙って CPU で動いて遅くなった。chrome://gpu は WebGPU が使える表示のまま（GPU のプロセスが落ちた回数も 0）。Chrome を再起動したら直った | Chrome は、GPU のデバイスが何度も失われたサイトの WebGPU を、再起動まで止めるとみられる。止められていたら、診断に「requestAdapter が null」と出し、抽出の前に「WebGPU を使用できません…CPU で続けますか？」と尋ねる | 2026-10-04 |

### iPad で fp16 が落ちる理由（見立て）
いちばん当てはまるのは [onnxruntime#26827](https://github.com/microsoft/onnxruntime/issues/26827)（Safari 26.2、ONNX Runtime Web 1.20〜1.23）。WebGPU 対応版（JSEP。`ort-wasm-simd-threaded.jsep.wasm`、28MB）を使うと、推論の**あと**も CPU 400%・メモリ 1GB 以上（14GB まで増える）が続き、iOS ではタブが落ちる。Safari が wasm を裏で最適化し直す処理（`JSC::Wasm::parseAndCompileOMG`）の中で起きている。WebGPU を含まない WASM 版では起きない、とされている。

- 「抽出は成功し、その直後に落ちる」のは、推論のあとに最適化し直す処理が走るためと合う
- fp16 は CPU（WASM）で動くので wasm のコードを多く動かし、最適化し直す対象が多い。fp32・int8 は WebGPU で動き、wasm はあまり動かないので起きにくい、と合う
- もう一つの見立て: WASM は fp16 を直接計算できず、fp32 への変換の分もタブのメモリを使う

対応: CPU で動かすときは、WebGPU を含まない WASM 版（`onnxruntime-web/wasm`、14MB）を読み込む（`src/worker.ts`。2026-10-03）。WebGPU で動かすときだけ WebGPU 対応版（JSEP、28MB）を読み込む。WeVocalSynth では両方を別の追加機能にし、使う方だけを入れる。

## ほかに報告されている問題（このモデルで起きるかは未確認）

| 問題 | 条件 | 出典 |
| --- | --- | --- |
| WebGPU の ConvTranspose が、fp16 で出力の大きさが約 2048 を超えると誤った値になる（添字を fp16 で計算している） | fp16、WebGPU、ORT 1.25〜 | [onnxruntime#28976](https://github.com/microsoft/onnxruntime/issues/28976)。Spleeter は ConvTranspose を使うので、fp16 の WebGPU で出力が 0 になる件と関係があるかもしれない |
| WebGPU で、入力が 8 個以上の Concat が、エラーなしにすべて 0 を返す | WebGPU | [onnxruntime#32757](https://github.com/microsoft/onnxruntime/issues/32757) |
| fp16 のモデルが WebGPU で NaN や誤った値になる（fp16 の桁あふれ） | fp16、WebGPU | [onnxruntime#26732](https://github.com/microsoft/onnxruntime/issues/26732)、[#26367](https://github.com/microsoft/onnxruntime/issues/26367) |
| iOS 26.3 の Safari で、WebGPU の推論を約 500 回続けると落ちる | iOS、WebGPU | [onnxruntime#27584](https://github.com/microsoft/onnxruntime/issues/27584) |
| Adreno 750（Android）で、ORT 1.30 から GPU のプロセスが落ちる（4bit の MatMulNBits のみ。このモデルは使わない） | Android、Adreno、ORT 1.30 | [musetric#901](https://github.com/musetric/musetric/issues/901) |
| Adreno 730（Snapdragon SM8450）で WebGPU の検証エラー | Android、Adreno 730 | [onnxruntime#21970](https://github.com/microsoft/onnxruntime/issues/21970) |
## 自動で替える組み合わせ
[src/compat.ts](../src/compat.ts) の `RULES` の `use`。設定で選んだモデルが当てはまると、抽出のときだけ代わりのモデルを使う（設定は変えない）。設定の画面にもその旨を出す。GPU を使えないモデル（`avoidBackend`）は、替えずに設定の「GPU処理を利用する」を押せなくし、CPU で処理すると表示する（以前は iPhone・iPad の fp16 を int8 に替えていたが、CPU で WebGPU を含まない版を使うようにしたのでやめた。2026-10-03）。

| 条件 | 選んだモデル | 代わりに使うモデル |
| --- | --- | --- |
| （今はなし） | | |

## まだ調べていないこと
- Android（Chrome）での各モデル・WebGPU
- iPhone での各モデル
- Mac・Safari での WebGPU
