// 追加機能「ボーカル抽出」（実行環境とモデル）を作る。アプリの scripts/build-addons.mjs から呼ぶ（WeVocalSynth と WeVocal Studio で共通）。
// 実行環境は extractor/vite.addons.config.ts でビルドする。アプリのフォルダーで実行する（extractor/ はアプリの中にある）
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models'
/** モデルの種類 → 配布物の名前（接尾辞）とファイルの接尾辞 */
const MODELS = {
  fp16: { archive: '-fp16', file: 'fp16.onnx' },
  int8: { archive: '-int8', file: 'int8.onnx' },
  fp32: { archive: '', file: 'onnx' },
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
/** 分けて置くときの 1 ファイルの大きさ（GitHub Pages の 1 ファイルの上限 100MB より小さく） */
const PART_BYTES = 90 * 2 ** 20

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? listFiles(p) : [p]
  })
}

/** `dir` のファイル一式からマニフェストを書く。バージョンは内容のハッシュ（中身が変わったときだけ更新を知らせる） */
export function writeManifest(id, dir, entry) {
  const files = listFiles(dir)
    .filter((p) => !p.endsWith('manifest.json'))
    .map((p) => {
      const data = readFileSync(p)
      return { path: relative(dir, p).replaceAll('\\', '/'), size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  const version = createHash('sha256').update(files.map((f) => f.sha256).join()).digest('hex').slice(0, 12)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, version, entry, files }, null, 2))
  const mb = files.reduce((s, f) => s + f.size, 0) / 2 ** 20
  console.log(`addon ${id} v${version}: ${files.length} files, ${mb.toFixed(1)} MB`)
}

/** 再配布するときに付けるライセンスの全文（extractor/licenses/）を、追加機能のフォルダに入れる。LICENSE-THIRD-PARTY.md 参照 */
const addLicenses = (dir, names) => {
  mkdirSync(join(dir, 'licenses'), { recursive: true })
  for (const n of names) copyFileSync(join(EXTRACTOR, 'licenses', n), join(dir, 'licenses', n))
}


/** アプリのフォルダーから見た extractor/ の場所 */
const EXTRACTOR = 'extractor'

/** 実行環境（vocal-extractor）と、ONNX Runtime の wasm（gpu、cpu）を `OUT` に作る */
export function buildRuntimeAddons(OUT) {
  process.env.ADDONS_OUT = OUT
  run(`npx vite build -c ${EXTRACTOR}/vite.addons.config.ts`)
  const base = join(OUT, 'vocal-extractor')
  for (const [id, pattern] of [['vocal-extractor-gpu', /^ort-wasm-simd-threaded\.jsep-.*\.wasm$/], ['vocal-extractor-cpu', /^ort-wasm-simd-threaded-.*\.wasm$/]]) {
    const dir = join(OUT, id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const files = readdirSync(join(base, 'assets')).filter((n) => pattern.test(n))
    if (files.length !== 1) throw new Error(`${id}: ONNX Runtime の wasm が見つからない（${files.join(', ')}）`)
    renameSync(join(base, 'assets', files[0]), join(dir, files[0]))
    addLicenses(dir, ['onnxruntime-MIT.txt'])
    writeManifest(id, dir, null)
  }
  addLicenses(base, ['onnxruntime-MIT.txt'])
  writeManifest('vocal-extractor', base, 'index.js')
}

/** モデル（Spleeter、UVR の MDX-Net、Demucs）を `OUT` に作る。取得したものは `CACHE` に置く（git には入れない。CI ではキャッシュする） */
export function buildModelAddons(OUT, CACHE = '.cache/addon-models') {
  mkdirSync(CACHE, { recursive: true })
  for (const [kind, m] of Object.entries(MODELS)) {
    const src = join(CACHE, `sherpa-onnx-spleeter-2stems${m.archive}`)
    if (!existsSync(src)) run(`curl -sSfL ${RELEASE}/sherpa-onnx-spleeter-2stems${m.archive}.tar.bz2 | tar xj -C ${CACHE}`)
    const dir = join(OUT, `spleeter-${kind}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    for (const stem of ['vocals', 'accompaniment']) copyFileSync(join(src, `${stem}.${m.file}`), join(dir, `${stem}.onnx`))
    addLicenses(dir, ['spleeter-MIT.txt', 'sherpa-onnx-Apache-2.0.txt'])
    writeManifest(`spleeter-${kind}`, dir, null)
  }

  // UVR の MDX-Net（sherpa-onnx が ONNX にして配っているもの）。1 ファイルを model.onnx に名前をそろえる（extractor/src/mdxModels.ts）
  const MDX = { 'uvr-mdx-voc-ft': 'UVR-MDX-NET-Voc_FT.onnx', 'uvr-mdx-inst-hq4': 'UVR-MDX-NET-Inst_HQ_4.onnx', 'uvr-mdx-kara2': 'UVR_MDXNET_KARA_2.onnx' }
  for (const [id, file] of Object.entries(MDX)) {
    const src = join(CACHE, file)
    if (!existsSync(src)) run(`curl -sSfL -o "${src}" ${RELEASE}/${file}`)
    const dir = join(OUT, id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    copyFileSync(src, join(dir, 'model.onnx'))
    addLicenses(dir, ['uvr-MIT.txt', 'sherpa-onnx-Apache-2.0.txt'])
    writeManifest(id, dir, null)
  }

  // Demucs（ONNX 版を Hugging Face から取得。extractor/src/demucsModels.ts）。GitHub Pages は 1 ファイル 100MB までなので、
  // model.onnx.000、.001… に分けて置き、アプリがつなげて読み込む（src/audio/vocalExtract.ts）
  const HF = 'https://huggingface.co/adowu'
  const DEMUCS = { 'demucs-4': `${HF}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx`, 'demucs-6': `${HF}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx` }
  for (const [id, url] of Object.entries(DEMUCS)) {
    const src = join(CACHE, url.split('/').pop())
    if (!existsSync(src)) run(`curl -sSfL -o "${src}" ${url}`)
    const dir = join(OUT, id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const data = readFileSync(src)
    for (let i = 0, at = 0; at < data.length; i++, at += PART_BYTES) {
      writeFileSync(join(dir, `model.onnx.${String(i).padStart(3, '0')}`), data.subarray(at, at + PART_BYTES))
    }
    addLicenses(dir, ['demucs-MIT.txt'])
    writeManifest(id, dir, null)
  }
}
