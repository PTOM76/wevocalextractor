// WeVocalSynth の submodule として開発しているとき、こちらの submodule（pevenmui・wevocal-lib）の登録を、
// 隣にあるもの（../pevenmui・../wevocal-lib）の今のコミットに合わせてコミットする（todo update:nested。todo bump でも最初に走る）。
// 隣のコミットがまだ push されていなければ止める（CI が取得できないため）。隣が無い（単体で clone した）ときは何もしない。
// こちらの submodule は隠している（todo setup:nested）ので、git submodule update ではなく登録を直接書き換え、
// 書き換えで外れる「隠す」印（skip-worktree）を付け直す
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (args, cwd = root) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim()

// 隠している submodule は `git commit -- パス` で拾えないので、ステージ全体をコミットする。
// ほかの変更がステージされていたら混ざるので止める
const staged = git('diff --cached --name-only').split('\n').filter((p) => p && p !== 'pevenmui' && p !== 'wevocal-lib')
if (staged.length) {
  console.error(`ほかの変更がステージされているので止める:\n${staged.join('\n')}`)
  process.exit(1)
}

const changed = []
for (const name of ['pevenmui', 'wevocal-lib']) {
  const sibling = resolve(root, '..', name)
  if (!existsSync(resolve(sibling, '.git'))) {
    console.log(`${name}: 隣に無いので飛ばす`)
    continue
  }
  const head = git('rev-parse HEAD', sibling)
  const current = git(`ls-tree HEAD ${name}`).split(/\s+/)[2]
  if (head === current) {
    console.log(`${name}: そのまま (${head.slice(0, 7)})`)
    continue
  }
  // push していないコミットを登録すると、CI が取得できず失敗するので止める（先に隣で push する）
  if (!git(`branch -r --contains ${head}`, sibling)) {
    console.error(`${name}: ${head.slice(0, 7)} はまだ push されていない。先に ../${name} で push する`)
    process.exit(1)
  }
  git(`update-index --cacheinfo 160000,${head},${name}`)
  changed.push(`${name} ${current?.slice(0, 7)} → ${head.slice(0, 7)}`)
}

if (changed.length) {
  git(`commit -m "chore: submodule を更新" -m "${changed.join('\n')}"`)
  console.log(changed.join('\n'))
}
// 隠す印を付け直す（登録を書き換えると外れる）
git('update-index --skip-worktree pevenmui wevocal-lib')
