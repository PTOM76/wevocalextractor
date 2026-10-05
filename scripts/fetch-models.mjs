// サイトで使うモデルを public/models/<種類>/ に置く（docs/MODELS.md）
//   sherpa-onnx の配布物を取得し、vocals.onnx / accompaniment.onnx に名前をそろえる。
//   取得した配布物は .cache/ に残し、2回目からはダウンロードしない
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(root, '.cache/models')
const OUT = join(root, 'public/models')
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models'
/** モデルの種類 → 配布物の名前（接尾辞）とファイルの接尾辞 */
const MODELS = {
  fp16: { archive: '-fp16', file: 'fp16.onnx' },
  int8: { archive: '-int8', file: 'int8.onnx' },
  fp32: { archive: '', file: 'onnx' },
}

mkdirSync(CACHE, { recursive: true })
for (const [kind, m] of Object.entries(MODELS)) {
  const src = join(CACHE, `sherpa-onnx-spleeter-2stems${m.archive}`)
  if (!existsSync(src)) execSync(`curl -sSfL ${RELEASE}/sherpa-onnx-spleeter-2stems${m.archive}.tar.bz2 | tar xj -C "${CACHE}"`, { stdio: 'inherit' })
  const dir = join(OUT, kind)
  mkdirSync(dir, { recursive: true })
  for (const stem of ['vocals', 'accompaniment']) copyFileSync(join(src, `${stem}.${m.file}`), join(dir, `${stem}.onnx`))
  console.log(`models/${kind}`)
}
// 再配布するモデルのライセンスを一緒に置く（LICENSE-THIRD-PARTY.md）
// UVR の MDX-Net（sherpa-onnx が ONNX にして配っているもの）は 1 ファイル。model.onnx に名前をそろえる
const MDX = { 'voc-ft': 'UVR-MDX-NET-Voc_FT.onnx', 'inst-hq4': 'UVR-MDX-NET-Inst_HQ_4.onnx' }
for (const [kind, file] of Object.entries(MDX)) {
  const src = join(CACHE, file)
  if (!existsSync(src)) execSync(`curl -sSfL -o "${src}" ${RELEASE}/${file}`, { stdio: 'inherit' })
  const dir = join(OUT, kind)
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, join(dir, 'model.onnx'))
  console.log(`models/${kind}`)
}
mkdirSync(join(OUT, 'licenses'), { recursive: true })
for (const n of ['spleeter-MIT.txt', 'uvr-MIT.txt', 'sherpa-onnx-Apache-2.0.txt', 'onnxruntime-MIT.txt']) copyFileSync(join(root, 'licenses', n), join(OUT, 'licenses', n))
