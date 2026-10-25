// 使い方の wiki を作る
// 1. docs/MANUAL.md を見出しごとに分けて docs/wiki/<ページ>.md を作り直し、EXTRA のページとサイドバー（sidebar.md）も作る（start.md だけは手で書く）
// 2. docs/wiki/*.md を DokuWiki 記法へ変換して dist/dokuwiki/ に書き出す
// 使い方: node scripts/docs-to-dokuwiki.mjs [名前空間]
//   名前空間を省くと、ページを wiki の直下に置き、リンクも [[pitch]] のようにページ名だけにする（アプリ 1 つだけの wiki のため）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const NS = process.argv[2] ?? 'extractor';
const SRC = 'docs/wiki';
const MANUAL = 'docs/MANUAL.md';
// MANUAL.md 以外から wiki に写すページ（docs のファイル → wiki のページ名）。docs の目次への「関連:」の行は外す
const EXTRA = {};
// 画像は GitHub の raw URL を直接参照する
const IMAGE_URL = 'https://raw.githubusercontent.com/PTOM76/wevocalextractor/main/docs/images';
const OUT = 'dist/dokuwiki';

// MANUAL.md の ## の見出しを、どのページに入れるか。ページの題と同じ見出しは題に含め、その中の見出しを 1 段上げる
const PAGES = [
	{ name: 'glossary', title: '用語', desc: 'このアプリで使う言葉の意味。', sections: ['用語'] },
	{ name: 'screen', title: '画面', desc: 'パソコンとスマホの画面の各部の名前と役割。', sections: ['画面'] },
	{ name: 'basics', title: '基本の流れ', desc: '曲を追加してから保存するまでの流れと、対応ファイル、データの保存先。', sections: ['基本の流れ', '対応ファイル', 'オフラインとデータの保存'] },
	{ name: 'extract', title: '抽出', desc: '抽出の設定と、一覧の操作。', sections: ['抽出の設定', '一覧の操作'] },
	{ name: 'save', title: '保存', desc: '抽出した結果の保存。', sections: ['保存'] },
	{ name: 'settings', title: '設定', desc: '設定画面の項目。', sections: ['設定'] },
	{ name: 'shortcuts', title: 'キーボード操作', desc: 'キーボードで使用できる操作の一覧。', sections: ['キーボード操作'] },
	{ name: 'troubleshooting', title: '困ったとき', desc: 'うまく動かないときの対処。', sections: ['困ったとき'] },
];

// GitHub の見出しのアンカー（MANUAL.md の中のリンクはこれで書いている）
const slug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

/** MANUAL.md を PAGES に分けて docs/wiki/<ページ>.md に書く */
function splitManual() {
	const lines = readFileSync(MANUAL, 'utf8').replace(/\r\n/g, '\n').split('\n');
	// ## ごとのかたまり
	const sections = new Map();
	let current = null;
	let fence = false;
	for (const line of lines) {
		if (/^\s*```/.test(line)) fence = !fence;
		const h2 = !fence && line.match(/^## (.+)$/);
		if (h2) sections.set((current = h2[1].trim()), []);
		else if (current) sections.get(current).push(line);
	}
	const used = new Set(PAGES.flatMap((p) => p.sections));
	const missing = [...sections.keys()].filter((k) => k !== '目次' && !used.has(k));
	if (missing.length) throw new Error(`MANUAL.md の見出しをどのページに入れるか決まっていない: ${missing.join(', ')}（PAGES に足す）`);
	// アンカー → ページ
	const where = new Map();
	for (const p of PAGES) {
		where.set(slug(p.title), p.name);
		for (const name of p.sections) {
			if (!sections.has(name)) throw new Error(`MANUAL.md に「## ${name}」がない`);
			where.set(slug(name), p.name);
			for (const l of sections.get(name)) {
				const h = l.match(/^#{3,6} (.+)$/);
				if (h) where.set(slug(h[1]), p.name);
			}
		}
	}
	for (const p of PAGES) {
		const out = [`# ${p.title}`, p.desc, ''];
		for (const name of p.sections) {
			const promote = name === p.title;
			if (!promote) out.push(`## ${name}`);
			for (const l of sections.get(name)) out.push(promote ? l.replace(/^#(#{2,5}) /, '$1 ') : l);
		}
		// 折りたたみ（<details>）は wiki では使わず、直前の見出しの 1 段下の見出しにする
		let level = 1;
		const flat = [];
		for (const l of out) {
			const h = l.match(/^(#{1,6}) /);
			if (h) level = h[1].length;
			if (/^\s*<\/?details[^>]*>\s*$/.test(l)) continue;
			const summary = l.match(/^\s*<summary>(.*)<\/summary>\s*$/);
			flat.push(summary ? `${'#'.repeat(Math.min(6, level + 1))} ${summary[1].replace(/<\/?b>/g, '')}` : l);
		}
		const md = flat
			.join('\n')
			.replace(/\]\(#([^)]+)\)/g, (all, a) => {
				const page = where.get(a);
				if (!page || page === p.name) return all;
				return a === slug(PAGES.find((x) => x.name === page).title) ? `](${page}.md)` : `](${page}.md#${a})`;
			})
			.replace(/src="images\//g, 'src="../images/')
			.replace(/\n{3,}/g, '\n\n')
			.trimEnd();
		writeFileSync(join(SRC, `${p.name}.md`), `${md}\n`);
	}
}

splitManual();
for (const [file, name] of Object.entries(EXTRA)) {
	const md = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^関連: .*\n+/m, '').replace(/src="images\//g, 'src="../images/');
	writeFileSync(join(SRC, `${name}.md`), md);
}
// サイドバー（DokuWiki の既定のテンプレートは sidebar のページを横に表示する）。PAGES と EXTRA から作り、ページを足しても直さずに済むようにする
writeFileSync(
	join(SRC, 'sidebar.md'),
	[
		'**[WeVocalExtractor](start.md)**',
		'',
		...PAGES.map((p) => `- [${p.title}](${p.name}.md)`),
		'',
		...Object.entries(EXTRA).map(([file, name]) => `- [${readFileSync(file, 'utf8').match(/^# (.+)$/m)?.[1] ?? name}](${name}.md)`),
		'',
	].join('\n'),
);
const pageId = (name) => (NS ? `${NS}:${name}` : name);
const sources = readdirSync(SRC).filter((f) => f.endsWith('.md')).map((f) => `${SRC}/${f}`);
const pageName = (file) => basename(file, '.md').toLowerCase();
const known = new Set(sources.map(pageName));

// 見出しの文字列 → DokuWiki のアンカー（近似）
const anchor = (s) => decodeURIComponent(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

function inline(text) {
	// インラインコードを退避してから他を変換する
	const codes = [];
	text = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
	text = text.replace(/<br\s*\/?>/g, '\\\\ ');
	text = text.replace(/<img\s[^>]*>/g, (tag) => {
		const src = tag.match(/src="([^"]+)"/)?.[1] ?? '';
		const alt = tag.match(/alt="([^"]*)"/)?.[1];
		const w = tag.match(/width="(\d+)"/)?.[1];
		// 外部の画像（README の画像など）はそのまま参照する
		const url = /^https?:/.test(src) ? src : `${IMAGE_URL}/${basename(src)}`;
		return `{{${url}${w ? `?${w}` : ''}${alt ? `|${alt}` : ''}}}`;
	});
	text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) =>
		`{{${IMAGE_URL}/${basename(src)}${alt ? `|${alt}` : ''}}}`);
	text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
		if (/^https?:/.test(href)) return `[[${href}|${label}]]`;
		const [path, hash] = href.split('#');
		if (!path && hash) return `[[#${anchor(hash)}|${label}]]`;
		if (path.endsWith('.md') && known.has(pageName(path))) {
			return `[[${pageId(pageName(path))}${hash ? `#${anchor(hash)}` : ''}|${label}]]`;
		}
		// wiki に載せないファイルへのリンクは文字だけ残す
		return label;
	});
	text = text.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1//$2//');
	text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
	return text.replace(/\u0000(\d+)\u0000/g, (_, i) => `''%%${codes[i]}%%''`);
}

function convert(md) {
	const out = [];
	const lines = md.replace(/\r\n/g, '\n').split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = line.match(/^\s*```(\w*)/);
		if (fence) {
			const body = [];
			while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
			out.push(`<code${fence[1] ? ` ${fence[1]}` : ''}>`, ...body, '</code>');
			continue;
		}
		// 折りたたみは folded プラグインの記法にする
		if (/^\s*<details[^>]*>\s*$/.test(line)) continue;
		const summary = line.match(/^\s*<summary>(.*)<\/summary>\s*$/);
		if (summary) {
			out.push(`++++ ${summary[1].replace(/<\/?b>/g, '')} |`);
			continue;
		}
		if (/^\s*<\/details>\s*$/.test(line)) {
			out.push('++++');
			continue;
		}
		const h = line.match(/^(#{1,5})\s+(.*)$/);
		if (h) {
			const eq = '='.repeat(7 - h[1].length);
			out.push(`${eq} ${h[2].trim()} ${eq}`);
			continue;
		}
		if (/^\s*\|/.test(line)) {
			const isSep = (l) => /^\s*\|?\s*:?-{2,}/.test(l);
			const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
			const header = isSep(lines[i + 1] ?? '');
			out.push(`${header ? '^' : '|'} ${cells(line).join(header ? ' ^ ' : ' | ')} ${header ? '^' : '|'}`);
			if (header) i++;
			continue;
		}
		const li = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
		if (li) {
			const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1;
			out.push(`${'  '.repeat(depth)}${/\d/.test(li[2]) ? '-' : '*'} ${inline(li[3])}`);
			continue;
		}
		const q = line.match(/^>\s?(.*)$/);
		if (q) {
			out.push(`> ${inline(q[1])}`);
			continue;
		}
		if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			out.push('----');
			continue;
		}
		out.push(inline(line));
	}
	return out.join('\n');
}

rmSync(OUT, { recursive: true, force: true });
const pagesDir = join(OUT, 'pages', ...(NS ? NS.split(':') : []));
mkdirSync(pagesDir, { recursive: true });

const manifest = [];
for (const src of sources) {
	const name = pageName(src);
	writeFileSync(join(pagesDir, `${name}.txt`), convert(readFileSync(src, 'utf8')));
	manifest.push({ id: pageId(name), source: src, file: ['pages', ...(NS ? NS.split(':') : []), `${name}.txt`].join('/') });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, '\t'));
console.log(`${manifest.length} 件を ${OUT} に書き出した`);
