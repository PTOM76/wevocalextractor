// dsp/（Rust）を wasm にビルドし、src/dsp.wasm にコピーする
//   WEVOCAL_LIB_PATH を指定すると、git の wevocal-lib の代わりに手元のものを使う。
//   指定がなくても、WeVocalSynth の submodule として隣に wevocal-lib があればそれを使う（両方を直しながら開発できるように）
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sibling = resolve(root, '../wevocal-lib')
const lib = process.env.WEVOCAL_LIB_PATH ?? (existsSync(resolve(sibling, 'Cargo.toml')) ? sibling : undefined)
const patch = lib
  ? ` --config "patch.'https://github.com/PTOM76/wevocal-lib.git'.wevocal-lib.path='${resolve(lib).replaceAll('\\', '/')}'"`
  : ''
execSync(`cargo build --release --target wasm32-unknown-unknown${patch}`, { cwd: resolve(root, 'dsp'), stdio: 'inherit' })
copyFileSync(resolve(root, 'dsp/target/wasm32-unknown-unknown/release/wevocalextractor_dsp.wasm'), resolve(root, 'src/dsp.wasm'))
console.log('wasm -> src/dsp.wasm')
