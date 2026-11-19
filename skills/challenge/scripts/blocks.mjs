#!/usr/bin/env node
/**
 * Challenge blocks: censor finished code into shaded lines, frame it with block markers, and later
 * restyle or remove the blocks. No dependencies; needs Node 20 or newer.
 *
 *   node blocks.mjs censor <file> --lines 38-73 --id C --title "Installing during render"
 *                          --tests 'npx vitest run -t "GDevice"' [--blur low|medium|high|bars]
 *                          [--save <solution file>] [--placeholder <code>]
 *   node blocks.mjs restyle <file> [--id C] [--blur [C=]low] [--solution C=<solution file>]
 *   node blocks.mjs list <file>...
 *   node blocks.mjs clean <file>
 *
 * Shared options: --width <columns|auto> and --tab-width <columns|auto>. Defaults come from
 * ~/.didactic/config.json ({ "width": 50, "blur": "low", "tabWidth": "auto" }), or the folder
 * named by DIDACTIC_HOME.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// ─── Shading ────────────────────────────────────────────────────────────────────────────────────

export const BLURS = ['low', 'medium', 'high', 'bars'];
const BRACKETS = new Set('()[]{}');
const WORD = /[\p{L}\p{N}_$]/u;

/**
 * Shade code by blur level, one block per character. `angles` holds the character indexes of `<`
 * and `>` that are paired brackets (see angleBrackets); any other `<` or `>` is an operator.
 * - low: spaces stay; brackets are ▓; letters, digits, `_`, `$` are ▒; everything else is ░.
 * - medium: spaces stay; brackets are ▓; everything else is ▒.
 * - high: spaces stay; everything else is ▒.
 * - bars: everything is ▒.
 */
export function shade(code, blur, angles = new Set()) {
	if (!BLURS.includes(blur)) throw new Error(`Unknown blur "${blur}": use ${BLURS.join(', ')}.`);
	return [...code]
		.map((ch, i) => {
			if (blur === 'bars') return '▒';
			if (/\s/.test(ch)) return ' ';
			if (blur === 'high') return '▒';
			if (BRACKETS.has(ch) || angles.has(i)) return '▓';
			return blur === 'medium' || WORD.test(ch) ? '▒' : '░';
		})
		.join('');
}

/** Languages where `<` and `>` also pair up, as generics, tags, or includes. */
const ANGLED = new Set(
	'ts tsx mts cts js jsx mjs cjs java kt kts swift rs cs c h cc cpp hpp dart html htm xml svg vue svelte'.split(' '),
);

/**
 * Find the `<` and `>` that pair up as brackets in some lines of code (without indentation), for
 * one per-line set of character indexes. Formatted code spaces its comparisons and shifts
 * (`x < y`, `a >> 2`), so an opening `<` touches the next character (`Array<T>`, `<div`, `</`,
 * `<>`) and a closing `>` touches the one before it or starts the line. Pairs can span lines, as
 * multi-line tags do; a candidate that never pairs stays an operator.
 */
export function angleBrackets(lines) {
	const found = lines.map(() => new Set());
	const open = [];
	lines.forEach((line, row) => {
		const chars = [...line];
		chars.forEach((ch, i) => {
			const prev = chars[i - 1];
			const next = chars[i + 1];
			if (ch === '<') {
				if (next !== undefined && !/[\s=<-]/.test(next) && prev !== '<') open.push([row, i]);
			} else if (ch === '>' && open.length > 0) {
				// Not `=>`, `->`, `>=`, or the second half of a `>>` shift.
				const closes =
					prev === undefined || (!/[\s=-]/.test(prev) && (prev !== '>' || found[row].has(i - 1)));
				if (closes && next !== '=') {
					const [r, j] = open.pop();
					found[r].add(j);
					found[row].add(i);
				}
			}
		});
	});
	return found;
}

// ─── Comment syntax ─────────────────────────────────────────────────────────────────────────────

const C_LIKE = { line: '//', block: ['/*', '*/'] };
const HASH = { line: '#' };
const DASHES = { line: '--' };
const MARKUP = { block: ['<!--', '-->'] };
const SYNTAX = {
	css: { block: ['/*', '*/'] },
	sql: DASHES,
	lua: DASHES,
	hs: DASHES,
};
for (const ext of 'js mjs cjs jsx ts tsx mts cts c h cc cpp hpp cs java kt kts swift go rs scala dart php scss less groovy'.split(' ')) {
	SYNTAX[ext] = C_LIKE;
}
for (const ext of 'py rb sh bash zsh yml yaml toml r pl ex exs nim'.split(' ')) SYNTAX[ext] = HASH;
for (const ext of 'html htm xml svg vue svelte md'.split(' ')) SYNTAX[ext] = MARKUP;

export function syntaxFor(file) {
	const syntax = SYNTAX[extname(file).slice(1).toLowerCase()];
	if (!syntax) throw new Error(`No comment syntax known for ${basename(file)}.`);
	return syntax;
}

/** The comment that wraps one censored line: a line comment, or an inline block comment. */
function lineComment(syntax) {
	return syntax.line ? [syntax.line, ''] : syntax.block;
}

// ─── Columns ────────────────────────────────────────────────────────────────────────────────────

const leading = (line) => /^[\t ]*/.exec(line)[0];
const codeOf = (line) => line.slice(leading(line).length).trimEnd();

/** For each line, the indexes of its `<` and `>` that are brackets, in languages that pair them. */
function angleSets(lines, { angles }) {
	return angles ? angleBrackets(lines.map(codeOf)) : lines.map(() => new Set());
}

/** The column whitespace reaches, with tabs stopping at multiples of the tab width. */
export function columns(whitespace, tabWidth) {
	let col = 0;
	for (const ch of whitespace) col = ch === '\t' ? col + tabWidth - (col % tabWidth) : col + 1;
	return col;
}

/** Whitespace reaching a column: tabs as far as they go, then spaces. */
function indentTo(col, useTabs, tabWidth) {
	if (!useTabs) return ' '.repeat(col);
	return '\t'.repeat(Math.floor(col / tabWidth)) + ' '.repeat(col % tabWidth);
}

/**
 * Render shaded content so it starts on `col`, the column the code started on. The comment marker
 * moves left into the indentation; at the left edge, where there's no room, the content shifts.
 */
function placeShade(content, col, useTabs, { syntax, tabWidth }) {
	const [open, close] = lineComment(syntax);
	const start = col - open.length;
	const lead = start >= 0 ? indentTo(start, useTabs, tabWidth) : '';
	return lead + open + content + close;
}

/** Censor one line of code in place. */
export function censorLine(line, { syntax, blur, tabWidth }, angles) {
	const indent = leading(line);
	return placeShade(shade(codeOf(line), blur, angles), columns(indent, tabWidth), indent.includes('\t'), {
		syntax,
		tabWidth,
	});
}

/**
 * Read a censored line back: its shaded content and the column the code started on. Returns null
 * for any other line. Also reads older blocks, which kept the code's indentation and put a space
 * after the comment marker.
 */
export function parseCensored(line, { syntax, tabWidth }) {
	const [open, close] = lineComment(syntax);
	const indent = leading(line);
	let rest = line.slice(indent.length).trimEnd();
	if (!rest.startsWith(open) || !rest.endsWith(close)) return null;
	rest = rest.slice(open.length, rest.length - close.length);
	const older = rest.startsWith(' ');
	const content = rest.trimStart();
	if (!/^[░▒▓][░▒▓ ]*$/.test(content)) return null;
	const col = columns(indent, tabWidth) + (older ? 0 : open.length);
	return { content, col, useTabs: indent.includes('\t') };
}

/** Sort lines into blank, comment, and code, following block comments across lines. */
export function classify(lines, syntax) {
	let inBlock = false;
	return lines.map((line) => {
		const text = line.trim();
		if (inBlock) {
			if (text.includes(syntax.block[1])) inBlock = false;
			return 'comment';
		}
		if (text === '') return 'blank';
		if (syntax.line && text.startsWith(syntax.line)) return 'comment';
		if (syntax.block && text.startsWith(syntax.block[0])) {
			const after = text.slice(syntax.block[0].length);
			if (!after.includes(syntax.block[1])) inBlock = true;
			return 'comment';
		}
		return 'code';
	});
}

// ─── Markers ────────────────────────────────────────────────────────────────────────────────────

const MIN_WIDTH = 30;

/** The marker lines above a block's content, `width` columns wide. */
export function header({ id, title, tests, width }) {
	const bar = `▌${'█'.repeat(width - 2)}▐`;
	const label = `▌███ [${id}] ${title} `;
	const fill = width - 1 - [...label].length;
	if (fill < 3) {
		const fits = [...title].length - (3 - fill);
		throw new Error(`"${title}" is too long for a ${width}-column block: keep it to ${fits} characters.`);
	}
	return [
		'▄'.repeat(width),
		bar,
		`${label}${'█'.repeat(fill)}▐`,
		bar,
		`${'▙▄▄▄ START CHALLENGE '.padEnd(width - 1, '▄')}▟`,
		`TESTS: ${tests}`,
	];
}

/** The marker lines below a block's content. */
export function footer({ width }) {
	const bar = `▌${'█'.repeat(width - 2)}▐`;
	return [`${'▛▀▀▀ END CHALLENGE '.padEnd(width - 1, '▀')}▜`, bar, bar, '▀'.repeat(width)];
}

/** Wrap marker lines in comments: one block comment where the language has them. */
function frame(lines, indent, syntax) {
	if (syntax.block) {
		return [indent + syntax.block[0], ...lines.map((line) => indent + line), indent + syntax.block[1]];
	}
	return lines.map((line) => `${indent}${syntax.line} ${line}`);
}

const OPENERS = new Set(['/*', '<!--']);
const CLOSERS = new Set(['*/', '-->']);
const TOKENS = /^(\/\/|#|--|\/\*|\*\/|<!--|-->)\s*/;

/** A marker line's text without comment tokens. */
function markerText(line) {
	let text = line.trim();
	for (let match; (match = TOKENS.exec(text)); ) text = text.slice(match[0].length);
	return text.replace(/\s*(\*\/|-->)$/, '');
}

function isMarker(line) {
	const text = markerText(line);
	if (line.trim() === '' || text === '') return false;
	if (/^[▄▀█▌▐▙▟▛▜]+$/.test(text)) return true;
	return /^[▌█]+ \[[A-Za-z0-9]+\] /.test(text);
}

// ─── Blocks ─────────────────────────────────────────────────────────────────────────────────────

/** Find every block in a file's lines: its marker range, id, title, tests, and content lines. */
export function findBlocks(lines) {
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		if (!markerText(lines[i]).startsWith('▙▄▄▄ START CHALLENGE')) continue;
		const startLine = i;

		// Above START: marker lines, up to and including an opening comment token.
		let first = startLine;
		while (first > 0) {
			const above = lines[first - 1].trim();
			if (OPENERS.has(above)) {
				first--;
				break;
			}
			if (!isMarker(lines[first - 1])) break;
			first--;
		}

		// Below START: the TESTS line, then a closing comment token.
		let next = startLine + 1;
		const testsMatch = /^TESTS:\s*(.*)$/.exec(markerText(lines[next] ?? ''));
		const tests = testsMatch ? testsMatch[1] : '';
		if (testsMatch) next++;
		if (CLOSERS.has(lines[next]?.trim())) next++;

		// END, with an opening comment token above it and marker lines below.
		let endLine = next;
		while (endLine < lines.length && !markerText(lines[endLine]).startsWith('▛▀▀▀ END CHALLENGE')) {
			endLine++;
		}
		if (endLine === lines.length) throw new Error(`The block starting on line ${startLine + 1} has no END.`);
		let contentEnd = endLine;
		if (OPENERS.has(lines[contentEnd - 1]?.trim())) contentEnd--;
		let last = endLine;
		while (last + 1 < lines.length) {
			const below = lines[last + 1].trim();
			if (CLOSERS.has(below)) {
				last++;
				break;
			}
			if (!isMarker(lines[last + 1])) break;
			last++;
		}

		const titleLine = lines.slice(first, startLine).map(markerText).find((text) => /\[[A-Za-z0-9]+\]/.test(text));
		const titleMatch = /\[([A-Za-z0-9]+)\]\s+(.*?)\s*[█▐]*$/.exec(titleLine ?? '');
		blocks.push({
			first,
			last,
			id: titleMatch?.[1] ?? '?',
			title: titleMatch?.[2] ?? '',
			tests,
			indent: leading(lines[startLine]),
			content: lines.slice(next, contentEnd),
		});
		i = last;
	}
	return blocks;
}

/** A block's lines, with markers at the current width. */
function renderBlock(block, settings) {
	const { syntax } = settings;
	const width = markerWidth(block.indent, settings);
	return [
		...frame(header({ ...block, width }), block.indent, syntax),
		...block.content,
		...frame(footer({ width }), block.indent, syntax),
	];
}

function markerWidth(indent, { width, lineLength, tabWidth }) {
	const result = width === 'auto' ? lineLength - columns(indent, tabWidth) : width;
	if (!Number.isInteger(result) || result < MIN_WIDTH) {
		throw new Error(`Blocks need at least ${MIN_WIDTH} columns; this one would get ${result}.`);
	}
	return result;
}

/**
 * Re-place a block's censored lines on their code's columns. With `source` (the solution's lines),
 * match each censored line to the next source line of its length: that line's own indentation
 * sets the column (a formatter may have moved the censored line), and `blur` shades it again.
 */
function restyleContent(content, settings, source, blur) {
	const kinds = source && classify(source, settings.syntax);
	const code = source ? source.filter((_, i) => kinds[i] === 'code') : null;
	const angles = code && blur ? angleSets(code, settings) : null;
	let cursor = 0;
	const missed = [];
	const out = content.map((line, i) => {
		const censored = parseCensored(line, settings);
		if (!censored) return line;
		if (!code) return placeShade(censored.content, censored.col, censored.useTabs, settings);
		const length = [...censored.content].length;
		const found = code.findIndex((text, j) => j >= cursor && [...text.trim()].length === length);
		if (found === -1) {
			missed.push(i);
			return placeShade(censored.content, censored.col, censored.useTabs, settings);
		}
		cursor = found + 1;
		const original = code[found];
		const shaded = blur ? censorLine(original, { ...settings, blur }, angles[found]) : null;
		const indent = leading(original);
		return (
			shaded ?? placeShade(censored.content, columns(indent, settings.tabWidth), indent.includes('\t'), settings)
		);
	});
	return { content: out, missed };
}

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────

const DEFAULTS = { width: 50, blur: 'low', tabWidth: 'auto' };

export function didacticHome() {
	return process.env.DIDACTIC_HOME ?? join(homedir(), '.didactic');
}

function readConfig() {
	const file = join(didacticHome(), 'config.json');
	return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** Parse JSON with comments and trailing commas, as editor settings files allow. */
export function parseJsonc(text) {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			const end = /"(?:[^"\\]|\\.)*"/y;
			end.lastIndex = i;
			const match = end.exec(text);
			out += match[0];
			i += match[0].length - 1;
		} else if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
		} else if (ch === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2) + 1;
		} else out += ch;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readJson(file, jsonc = false) {
	try {
		const text = readFileSync(file, 'utf8');
		return jsonc ? parseJsonc(text) : JSON.parse(text);
	} catch {
		return null;
	}
}

function findUp(start, name) {
	for (let dir = start; ; dir = dirname(dir)) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

function globToRegExp(glob) {
	let source = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				source += '.*';
				i++;
			} else source += '[^/]*';
		} else if (ch === '?') source += '[^/]';
		else if (ch === '{') source += '(?:';
		else if (ch === '}') source += ')';
		else if (ch === ',' && source.includes('(?:')) source += '|';
		else source += ch.replace(/[.+^$()|\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

/** The .editorconfig properties that apply to a file, nearest file and last section winning. */
export function editorconfigFor(file) {
	const files = [];
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		const config = join(dir, '.editorconfig');
		if (existsSync(config)) {
			const text = readFileSync(config, 'utf8');
			files.unshift({ dir, text });
			if (/^\s*root\s*=\s*true\s*$/im.test(text)) break;
		}
		if (dirname(dir) === dir) break;
	}
	const props = {};
	for (const { dir, text } of files) {
		let applies = false;
		for (const raw of text.split('\n')) {
			const line = raw.trim();
			if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
			const section = /^\[(.*)\]$/.exec(line);
			if (section) {
				const glob = section[1].includes('/') ? section[1].replace(/^\//, '') : `**/${section[1]}`;
				const path = relative(dir, file).split('\\').join('/');
				applies = globToRegExp(glob).test(path) || globToRegExp(section[1]).test(basename(file));
				continue;
			}
			const pair = /^([^=]+)=(.*)$/.exec(line);
			if (applies && pair) props[pair[1].trim().toLowerCase()] = pair[2].trim().toLowerCase();
		}
	}
	return props;
}

const LANGUAGE_IDS = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'typescriptreact',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascriptreact',
	py: 'python',
	md: 'markdown',
};

function vscodeUserSettings() {
	const home = homedir();
	const base =
		process.platform === 'darwin'
			? join(home, 'Library', 'Application Support')
			: process.platform === 'win32'
				? (process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
				: (process.env.XDG_CONFIG_HOME ?? join(home, '.config'));
	return readJson(join(base, 'Code', 'User', 'settings.json'), true);
}

/** An editor setting for a file: the workspace's, then the user's, language-specific first. */
function vscodeSetting(file, key) {
	const ext = extname(file).slice(1);
	const language = `[${LANGUAGE_IDS[ext] ?? ext}]`;
	const workspace = findUp(dirname(file), join('.vscode', 'settings.json'));
	for (const settings of [workspace && readJson(workspace, true), vscodeUserSettings()]) {
		const value = settings?.[language]?.[key] ?? settings?.[key];
		if (value !== undefined) return value;
	}
	return undefined;
}

/** How wide a tab looks in the editor, so censored lines can line up with the code they hide. */
export function detectTabWidth(file) {
	const editorconfig = editorconfigFor(file);
	for (const value of [editorconfig.tab_width, editorconfig.indent_size]) {
		if (/^\d+$/.test(value ?? '')) return Number(value);
	}
	const tabSize = vscodeSetting(file, 'editor.tabSize');
	return Number.isInteger(tabSize) ? tabSize : 4;
}

/** The project's line length: the editor's first ruler, .editorconfig, or Prettier's printWidth. */
export function detectLineLength(file) {
	const rulers = vscodeSetting(file, 'editor.rulers');
	const ruler = Array.isArray(rulers) ? rulers[0] : undefined;
	const column = typeof ruler === 'object' ? ruler?.column : ruler;
	if (Number.isInteger(column)) return column;
	const maxLength = editorconfigFor(file).max_line_length;
	if (/^\d+$/.test(maxLength ?? '')) return Number(maxLength);
	for (const name of ['.prettierrc', '.prettierrc.json', 'package.json']) {
		const found = findUp(dirname(file), name);
		const json = found && readJson(found);
		const printWidth = name === 'package.json' ? json?.prettier?.printWidth : json?.printWidth;
		if (Number.isInteger(printWidth)) return printWidth;
	}
	return DEFAULTS.width;
}

function settingsFor(file, options) {
	const config = { ...DEFAULTS, ...readConfig() };
	const pick = (key) => options[key] ?? config[key];
	const number = (value) => (value === 'auto' ? 'auto' : Number(value));
	const width = number(pick('width'));
	const tabWidth = number(pick('tabWidth'));
	return {
		syntax: syntaxFor(file),
		angles: ANGLED.has(extname(file).slice(1).toLowerCase()),
		width,
		lineLength: width === 'auto' ? detectLineLength(file) : null,
		tabWidth: tabWidth === 'auto' ? detectTabWidth(file) : tabWidth,
		blur: pick('blur'),
	};
}

// ─── Commands ───────────────────────────────────────────────────────────────────────────────────

function readLines(file) {
	return readFileSync(file, 'utf8').split('\n');
}

function located(file, lines) {
	return findBlocks(lines).map(
		(block) => `${file}:${block.first + 1}-${block.last + 1}  [${block.id}] ${block.title}  (blur: ${blurOf(block)})`,
	);
}

/** Which blur a block's censored lines show, as far as the shades tell. */
function blurOf(block) {
	const shaded = block.content.map((line) => /[░▒▓][░▒▓ ]*$/.exec(line)?.[0] ?? '').join('');
	if (!shaded) return 'none censored';
	if (shaded.includes('░')) return 'low';
	if (shaded.includes('▓')) return 'medium';
	return shaded.includes(' ') ? 'high' : 'bars';
}

/** Censor lines `from`-`to` (1-based, inclusive) of a file into a new block. */
export function censor(file, { lines: range, id, title, tests, save, placeholder, ...options }) {
	const settings = settingsFor(file, options);
	const lines = readLines(file);
	const [from, to] = range.split('-').map(Number);
	if (!(from >= 1 && to >= from && to <= lines.length)) throw new Error(`Bad line range "${range}".`);
	const piece = lines.slice(from - 1, to);
	if (save) {
		mkdirSync(dirname(save), { recursive: true });
		writeFileSync(save, `${piece.join('\n')}\n`);
	}

	const kinds = classify(piece, settings.syntax);
	const indent = leading(piece.find((line) => line.trim() !== '') ?? '');
	const codeRows = piece.flatMap((_, i) => (kinds[i] === 'code' ? [i] : []));
	const angles = angleSets(codeRows.map((i) => piece[i]), settings);
	const content = piece.map((line, i) =>
		kinds[i] === 'code' ? censorLine(line, settings, angles[codeRows.indexOf(i)]) : line,
	);
	if (content[0]?.trim() !== '') content.unshift('');
	if (content.at(-1)?.trim() !== '') content.push('');
	if (placeholder) {
		const note = 'Placeholder, so the file compiles until the code above is written. Delete it then.';
		const [open, close] = lineComment(settings.syntax);
		content.push(`${indent}${open} ${note}${close ? ` ${close}` : ''}`);
		content.push(...placeholder.split('\n').map((line) => indent + line), '');
	}

	const block = { id, title, tests, indent, content };
	const rendered = renderBlock(block, settings);
	lines.splice(from - 1, to - from + 1, ...rendered);
	writeFileSync(file, lines.join('\n'));
	return `${file}:${from}-${from + rendered.length - 1}  [${id}] ${title}`;
}

/** Redraw blocks at the current width and alignment, optionally at a new blur. */
export function restyle(file, { id, blur = [], solution = [], ...options }) {
	const settings = settingsFor(file, options);
	const perBlock = (values) =>
		Object.fromEntries(values.map((value) => (value.includes('=') ? value.split(/=(.*)/s).slice(0, 2) : ['*', value])));
	const blurs = perBlock(blur);
	const solutions = perBlock(solution);
	const lines = readLines(file);
	const notes = [];
	for (const block of findBlocks(lines).reverse()) {
		if (id && block.id !== id) continue;
		const level = blurs[block.id] ?? blurs['*'];
		const sourceFile = solutions[block.id] ?? solutions['*'];
		if (level && !sourceFile) throw new Error(`Changing [${block.id}]'s blur needs --solution ${block.id}=<file>.`);
		const source = sourceFile ? readLines(sourceFile) : null;
		const { content, missed } = restyleContent(block.content, settings, source, level);
		for (const i of missed) notes.push(`[${block.id}] no solution line matches censored line ${i + 1} of the block; kept as it was.`);
		const rendered = renderBlock({ ...block, content }, settings);
		lines.splice(block.first, block.last - block.first + 1, ...rendered);
	}
	writeFileSync(file, lines.join('\n'));
	return [...located(file, lines), ...notes].join('\n');
}

/** Remove block markers, censored lines, and placeholders, keeping the code and comments. */
export function clean(file, options = {}) {
	const settings = settingsFor(file, options);
	const lines = readLines(file);
	for (const block of findBlocks(lines).reverse()) {
		const kept = [];
		for (let i = 0; i < block.content.length; i++) {
			const line = block.content[i];
			if (parseCensored(line, settings)) continue;
			if (line.includes('Placeholder, so the')) {
				while (block.content[i + 1]?.trim()) i++;
				continue;
			}
			if (line.trim() === '' && (kept.length === 0 || kept.at(-1).trim() === '')) continue;
			kept.push(line);
		}
		while (kept.at(-1)?.trim() === '') kept.pop();
		lines.splice(block.first, block.last - block.first + 1, ...kept);
	}
	writeFileSync(file, lines.join('\n'));
	return `${file}: cleaned`;
}

// ─── CLI ────────────────────────────────────────────────────────────────────────────────────────

const OPTIONS = {
	lines: { type: 'string' },
	id: { type: 'string' },
	title: { type: 'string' },
	tests: { type: 'string' },
	blur: { type: 'string', multiple: true },
	solution: { type: 'string', multiple: true },
	save: { type: 'string' },
	placeholder: { type: 'string' },
	width: { type: 'string' },
	'tab-width': { type: 'string' },
};

export function main(argv) {
	const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
	const [command, ...files] = positionals;
	const { 'tab-width': tabWidth, ...rest } = values;
	const options = { ...rest, ...(tabWidth !== undefined && { tabWidth }) };
	if (files.length === 0) throw new Error('Name a file.');
	const paths = files.map((file) => resolve(file));
	switch (command) {
		case 'censor': {
			for (const key of ['lines', 'id', 'title', 'tests']) {
				if (!options[key]) throw new Error(`censor needs --${key}.`);
			}
			return censor(paths[0], { ...options, blur: options.blur?.[0] });
		}
		case 'restyle':
			return paths.map((path) => restyle(path, options)).join('\n');
		case 'list':
			return paths.flatMap((path) => located(path, readLines(path))).join('\n');
		case 'clean':
			return paths.map((path) => clean(path, options)).join('\n');
		default:
			throw new Error('Commands: censor, restyle, list, clean.');
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	try {
		console.log(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
