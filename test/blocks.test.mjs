import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	censorLine,
	clean,
	censor,
	columns,
	findBlocks,
	footer,
	header,
	parseCensored,
	parseJsonc,
	restyle,
	shade,
	syntaxFor,
} from '../skills/challenge/scripts/blocks.mjs';

const ts = syntaxFor('x.ts');

function scratch(name, text) {
	const dir = mkdtempSync(join(tmpdir(), 'didactic-'));
	process.env.DIDACTIC_HOME = dir;
	const file = join(dir, name);
	writeFileSync(file, text);
	return { dir, file, read: () => readFileSync(file, 'utf8') };
}

describe('shade', () => {
	const code = 'var handle = setTimeout(callback, 100)';

	it('keeps spaces and marks brackets and punctuation at low blur', () => {
		assert.equal(shade(code, 'low'), '▒▒▒ ▒▒▒▒▒▒ ░ ▒▒▒▒▒▒▒▒▒▒▓▒▒▒▒▒▒▒▒░ ▒▒▒▓');
	});

	it('marks only spaces at medium blur', () => {
		assert.equal(shade(code, 'medium'), '▒▒▒░▒▒▒▒▒▒░▒░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░▒▒▒▒');
	});

	it('hides everything at high blur', () => {
		assert.equal(shade(code, 'high'), '▒'.repeat(code.length));
	});

	it('rejects an unknown blur', () => {
		assert.throws(() => shade(code, 'extreme'), /Unknown blur/);
	});
});

describe('censorLine', () => {
	it('moves the comment marker into the indentation, so the shading starts where the code did', () => {
		const line = "\t\tconsole.log('Hello world');";
		assert.equal(censorLine(line, { syntax: ts, blur: 'high', tabWidth: 4 }), `\t  //${'▒'.repeat(27)}`);
		assert.equal(censorLine(line, { syntax: ts, blur: 'high', tabWidth: 2 }), `\t//${'▒'.repeat(27)}`);
	});

	it('uses spaces in space-indented code', () => {
		assert.equal(censorLine('    x;', { syntax: ts, blur: 'high', tabWidth: 4 }), '  //▒▒');
	});

	it('shifts the shading at the left edge, where there is no room', () => {
		assert.equal(censorLine('x;', { syntax: ts, blur: 'high', tabWidth: 4 }), '//▒▒');
	});

	it('wraps the line in a block comment in CSS', () => {
		const css = syntaxFor('x.css');
		assert.equal(censorLine('\t\tcolor: red;', { syntax: css, blur: 'low', tabWidth: 4 }), '\t  /*▒▒▒▒▒░ ▒▒▒░*/');
	});

	it('reads censored lines back, including the older style', () => {
		const settings = { syntax: ts, tabWidth: 4 };
		assert.deepEqual(parseCensored('\t  //▒▒ ░', settings), { content: '▒▒ ░', col: 8, useTabs: true });
		assert.deepEqual(parseCensored('\t\t// ▒▒▒', settings), { content: '▒▒▒', col: 8, useTabs: true });
		assert.equal(parseCensored('\t\t// a comment', settings), null);
	});
});

describe('markers', () => {
	it('draws a header and footer exactly as wide as asked', () => {
		const lines = [...header({ id: 'C', title: 'Installing during render', tests: 'npm test', width: 50 }), ...footer({ width: 50 })];
		for (const line of lines.filter((line) => !line.startsWith('TESTS'))) assert.equal([...line].length, 50);
		assert.equal(lines[2], `▌███ [C] Installing during render ${'█'.repeat(15)}▐`);
		assert.equal(lines[4], `▙▄▄▄ START CHALLENGE ${'▄'.repeat(28)}▟`);
		assert.equal(lines[6], `▛▀▀▀ END CHALLENGE ${'▀'.repeat(30)}▜`);
	});

	it('rejects a title too long for the width', () => {
		assert.throws(() => header({ id: 'C', title: 'x'.repeat(40), tests: '', width: 50 }), /keep it to 36/);
	});
});

describe('columns', () => {
	it('stops tabs at multiples of the tab width', () => {
		assert.equal(columns('\t \t', 4), 8);
		assert.equal(columns('  \t', 2), 4);
	});
});

describe('parseJsonc', () => {
	it('ignores comments and trailing commas, but not slashes inside strings', () => {
		assert.deepEqual(parseJsonc('{ // note\n "a": "http://x", /* b */ "c": [1,], }'), { a: 'http://x', c: [1] });
	});
});

describe('blocks in a file', () => {
	const source = [
		'function f(): number {',
		'\t// Add them up.',
		'\tconst total = 1 + 2;',
		'',
		'\treturn total;',
		'}',
		'',
	].join('\n');

	it('censors a range into a block, saves the solution, and finds the block again', () => {
		const { dir, file, read } = scratch('f.ts', source);
		const save = join(dir, 'solution.ts');
		censor(file, { lines: '2-5', id: 'A', title: 'Adding up', tests: 'npm test', save, placeholder: 'return 0;', width: '50', tabWidth: '4' });
		assert.equal(readFileSync(save, 'utf8'), '\t// Add them up.\n\tconst total = 1 + 2;\n\n\treturn total;\n');
		const text = read();
		assert.match(text, /\n\t\/\/ Add them up\.\n  \/\/▒{20}\n\n  \/\/▒{13}\n/);
		assert.match(text, /\t\/\/ Placeholder, so the file compiles/);
		const [block] = findBlocks(text.split('\n'));
		assert.equal(block.id, 'A');
		assert.equal(block.title, 'Adding up');
		assert.equal(block.tests, 'npm test');
	});

	it('restyles to a new blur from the solution, and cleans back to the code and comments', () => {
		const { dir, file, read } = scratch('f.ts', source);
		const save = join(dir, 'solution.ts');
		censor(file, { lines: '2-5', id: 'A', title: 'Adding up', tests: 'npm test', save, width: '50', tabWidth: '4' });
		restyle(file, { blur: ['A=low'], solution: [`A=${save}`], width: '40', tabWidth: '4' });
		const text = read();
		assert.match(text, /  \/\/▒▒▒▒▒ ▒▒▒▒▒ ░ ▒ ░ ▒░\n/);
		assert.match(text, new RegExp(`\\t${'▄'.repeat(40)}\\n`));
		clean(file, { tabWidth: '4' });
		assert.equal(read(), 'function f(): number {\n\t// Add them up.\n}\n');
	});

	it('converts older line-comment blocks, keeping the user’s own code', () => {
		const older = [
			'function f(): number {',
			'\t// ████████████████████████████████████████',
			'\t// ████ [B] Adding up ██████████████████████',
			'\t// ████████████████████████████████████████',
			'\t// ▙▄▄▄ START CHALLENGE ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟',
			'\t// TESTS: npm test',
			'',
			'\t// ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒',
			'\treturn 3;',
			'',
			'\t// ▛▀▀▀ END CHALLENGE ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜',
			'\t// ████████████████████████████████████████',
			'\t// ████████████████████████████████████████',
			'\t// ████████████████████████████████████████',
			'}',
		].join('\n');
		const { file, read } = scratch('f.ts', older);
		restyle(file, { width: '50', tabWidth: '4' });
		const lines = read().split('\n');
		assert.deepEqual(lines.slice(0, 3), ['function f(): number {', '\t/*', `\t${'▄'.repeat(50)}`]);
		assert.ok(lines.includes(`  //${'▒'.repeat(19)}`));
		assert.ok(lines.includes('\treturn 3;'));
		assert.deepEqual(lines.slice(-3), [`\t${'▀'.repeat(50)}`, '\t*/', '}']);
		const [block] = findBlocks(lines);
		assert.deepEqual([block.id, block.title, block.tests], ['B', 'Adding up', 'npm test']);
	});
});
