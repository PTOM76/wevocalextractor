# 端末との互換性
モデルと計算の種類（WASM / WebGPU）が、どの端末・ブラウザでうまく動かないかを記録する。見つけたら表に足し、自動で別のモデルに替えるもの（[src/compat.ts](../src/compat.ts) の表）も合わせて直す。

モデルそのものの説明は [MODELS.md](MODELS.md)、そうした決め事の理由は [DECISIONS.md](DECISIONS.md) を参照。調べるときは、設定の「開発者向け」→「抽出の診断」の結果を貼る。

## 分かっていること

| 端末・ブラウザ | モデル | 計算 | 結果 | 対応 | 日付 |
| --- | --- | --- | --- | --- | --- |
| PC・Chrome（ONNX Runtime Web 1.30） | fp16 | WebGPU | エラーは出ずに出力がすべて 0 | fp16 は常に WASM で動かす | 2026-10-01 |
| iPad（iPadOS、Safari 26.6、PWA） | すべて | すべて | 実行環境を作り直すと `RangeError: Out of memory`（no available backend found） | wasm のメモリの上限を 1GB に下げる（DECISIONS.md） | 2026-10-03 |
| iPad（iPadOS、Safari 26.6、PWA） | fp16 | WASM（fp16 は WebGPU を使わない） | 抽出のあと（トラックに分けた直後など）にタブが落ちる | **自動で int8 に替える** | 2026-10-03 |
| iPad（iPadOS、Safari 26.6、PWA） | int8・fp32 | WebGPU | 抽出できる | — | 2026-10-03 |

### iPad で fp16 が落ちる理由（見立て）
fp16 は WebGPU で動かせないので CPU（WASM）で動く。WASM は fp16 を直接計算できず、ONNX Runtime が重みや途中の値を fp32 に変換しながら計算するので、ファイルの小ささとは逆にタブのメモリを多く使う。WebGPU で動く int8・fp32 は、途中の値の多くを GPU 側に置くので、タブのメモリが足りなくなりにくい。

## 自動で替える組み合わせ
[src/compat.ts](../src/compat.ts) の `RULES`。設定で選んだモデルが当てはまると、抽出のときだけ代わりのモデルを使う（設定は変えない）。設定の画面にもその旨を出す。

| 条件 | 選んだモデル | 代わりに使うモデル |
| --- | --- | --- |
| iPhone・iPad（iPadOS の Safari は Mac を名乗るので、タッチの数でも見分ける） | fp16 | int8 |

## まだ調べていないこと
- Android（Chrome）での各モデル・WebGPU
- iPhone での各モデル
- Mac・Safari での WebGPU
