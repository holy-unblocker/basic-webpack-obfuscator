// babel sucks! Property.shorthand is missing in the typedefs, traverse module is incorrectly typed (it isn't a __esModule but they export using `module.export.default = traverse;`, so annoying!)
import generateMod from '@babel/generator';
import { parse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseMod from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';

const traverse = (traverseMod as unknown as { default: typeof traverseMod })
	.default;

const generate = (generateMod as unknown as { default: typeof generateMod })
	.default;

/**
 * Converts string to JavaScript string wrapped in quotes
 */
function escapeString(string: string) {
	let result = '';

	for (let i = 0; i < string.length; i++) {
		const char = string.charCodeAt(i);

		result += '\\u' + char.toString(16).padStart(4, '0');
	}

	return '"' + result + '"';
}

function transformString(input: string, key: number) {
	const xor = key >> 0x4;
	const frequency = key & 0xf;

	let output = '';

	for (let i = 0; i < input.length; i++) {
		if (i % frequency === 0) {
			output += String.fromCharCode(input[i].charCodeAt(0) ^ xor);
		} else {
			output += input[i];
		}
	}

	return output;
}

const callFunction = `__BWOC_CALLBACK__`;

const callFunctionBody = `((key, dump) => (start, end) => {
	const input = dump.slice(start, end);
	
	const xor = key >> 0x4;
	const frequency = key & 0xf;

	let output = '';

	for (let i = 0; i < input.length; i++) {
		if (i % frequency === 0) {
			output += String.fromCharCode(input[i].charCodeAt() ^ xor);
		} else {
			output += input[i];
		}
	}

	return output;
})`;

export interface ObfuscateOptions {
	salt: number;
	compact: boolean;
	source: string;
	sourceMap?: boolean;
	exclude: ((identifier: string) => boolean)[];
}

export interface ObfuscateResult {
	code: string;
	map?: SourceMap;
}

export default function obfuscate(
	code: string,
	options: { sourceMap: false } & ObfuscateOptions
): Omit<ObfuscateResult, 'map'>;

export default function obfuscate(
	code: string,
	options: { sourceMap: true } & ObfuscateOptions
): ObfuscateResult & { map: SourceMap };

export default function obfuscate(
	code: string,
	options: ObfuscateOptions
): ObfuscateResult;

export default function obfuscate(
	code: string,
	options: ObfuscateOptions
): ObfuscateResult {
	const badKey = 0xfff + (options.salt % 0xfff);
	const xor = badKey >> 0x4;
	// 2-3
	const frequency = ((badKey & 0xf) % 2) + 2;

	// SHORT xor
	// CHAR frequency
	const key = (xor << 4) + frequency;

	const magic = new MagicString(code);

	const tree = parse(code, {
		allowAwaitOutsideFunction: true,
		allowImportExportEverywhere: true,
		allowReturnOutsideFunction: true,
		attachComment: false,
		...(options.sourceMap ? { sourceFilename: options.source } : {}),
	});

	const strings = new Map<string, { start: number; end: number }>();
	let stringsDump = '';
	let stringDumpPos = 0;

	function appendString(string: string) {
		if (!strings.has(string)) {
			const transformed = transformString(string, key);
			strings.set(string, {
				start: stringDumpPos,
				end: stringDumpPos + transformed.length,
			});
			stringsDump += transformed;
			stringDumpPos += transformed.length;
		}

		const got = strings.get(string);

		return {
			ast: t.callExpression(t.identifier(callFunction), [
				t.numericLiteral(got.start),
				t.numericLiteral(got.end),
			]),
			code: `/*#__PURE__*/ ${callFunction}(${JSON.stringify(
				got.start
			)},${JSON.stringify(got.end)})`,
		};
	}

	/*
	`${x}str`
	`${x}${call()}`
	*/

	/*
	const { test } =
	const { [call()]: test } =
	*/

	interface SkipLoc {
		start: number;
		end: number;
	}

	const skipObfuscation: SkipLoc[] = [];

	{
		const commentMatches: [enable: boolean, offset: number][] = [];

		code.replace(/obfuscation:enable/g, (match, offset: number) => {
			commentMatches.push([true, offset]);
			return '';
		});

		code.replace(/obfuscation:disable/g, (match, offset: number) => {
			commentMatches.push([false, offset]);
			return '';
		});

		let skipBuilding: Partial<SkipLoc> | undefined;

		for (const [enable, offset] of commentMatches) {
			if (enable) {
				if (!skipBuilding) {
					console.warn('Unmatched :disable command');
				} else {
					skipBuilding.end = offset;
					skipObfuscation.push(skipBuilding as SkipLoc);
					skipBuilding = undefined;
				}
			} else {
				const loc = { start: offset };
				skipBuilding = loc;
			}
		}
	}

	// const obfuscatedNodes = new WeakSet<t.Node>();

	function willSkip(path: NodePath<t.Node>) {
		// if (obfuscatedNodes.has(path.node)) return true;

		for (const loc of skipObfuscation)
			if (
				loc.start < path.node.start &&
				'end' in loc &&
				loc.end > path.node.start
			)
				return true;

		return false;
	}

	const templateLiterals: t.TemplateLiteral[] = [];

	function test(identifier: string) {
		for (const test of options.exclude) {
			if (test(identifier)) return false;
		}

		return true;
	}

	traverse(tree, {
		/*ImportDeclaration: traverseSkip,
		ExportDeclaration: traverseSkip,
		ExportAllDeclaration: traverseSkip,
		ExportDefaultDeclaration: traverseSkip,
		CallExpression(path) {
			if (t.isImport(path.node.callee)) path.skip();
		},*/
		TemplateLiteral(path) {
			if (willSkip(path)) return;

			templateLiterals.push(path.node);
		},
		ObjectProperty(path) {
			if (willSkip(path)) return;

			let key: string | undefined;

			let pos: [number, number] | undefined;

			if (t.isIdentifier(path.node.key) && !path.node.computed) {
				key = path.node.key.name;
				pos = [path.node.key.start, path.node.key.end];
			} else if (t.isStringLiteral(path.node.key)) {
				key = path.node.key.value;
				pos = [path.node.key.start, path.node.key.end];
			}

			if (key === undefined || pos === undefined || !test(key)) return;

			const appent = appendString(key);

			if (!path.node.computed) {
				// fake computed
				magic.appendLeft(pos[0], '[');
				magic.appendRight(pos[1], ']');
			}

			if (path.node.shorthand) {
				magic.appendRight(
					pos[1],
					': ' + (path.node.value as t.Identifier).name
				);
			}

			magic.overwrite(pos[0], pos[1], appent.code);

			// console.log(magic.slice(pos[0] - 10, pos[1] + 10));

			const ast = t.objectProperty(
				appent.ast,
				path.node.value,
				true,
				(path.node as any).shorthand,
				path.node.decorators
			);

			path.replaceWith(ast)[0].skip();
		},
		SwitchCase(path) {
			if (willSkip(path)) return;

			if (t.isStringLiteral(path.node.test)) {
				const appent = appendString(path.node.test.value);

				// the only CASE where there is no space between a call expression and "case"
				// case"test":
				// case__BWOC...!!

				magic.overwrite(
					path.node.test.start,
					path.node.test.end,
					' ' + appent.code
				);

				path.node.test = appent.ast;

				path.skip();
			}
		},
		StringLiteral(path) {
			if (willSkip(path) || !test(path.node.value)) return;

			const appent = appendString(path.node.value);

			magic.overwrite(path.node.start, path.node.end, ' ' + appent.code);

			path.replaceWith(appent.ast)[0].skip();
		},
	});

	for (const node of templateLiterals) {
		const quasis: t.TemplateElement[] = [];
		const expressions: t.Expression[] = [];

		const nodeExpressions: t.Expression[] = [
			...(node.expressions as t.Expression[]),
		];

		for (const element of node.quasis) {
			if (element.value.raw) {
				if (test(element.value.raw)) {
					expressions.push(appendString(element.value.raw).ast);
					quasis.push(t.templateElement({ raw: '' }, false));
				} else {
					quasis.push(t.templateElement({ raw: element.value.raw }, false));
				}
			}

			if (!element.tail) {
				expressions.push(nodeExpressions.shift());
				quasis.push(t.templateElement({ raw: '' }, false));
			}
		}

		quasis.push(t.templateElement({ raw: '' }, true));

		// dont skip the entire node and children
		// keep children but dont re-process replaced node
		// path.skip()

		const ast = t.templateLiteral(quasis, expressions);

		// obfuscatedNodes.add(ast);

		magic.overwrite(node.start, node.end, generate(ast).code);

		// path.replaceWith(ast);
	}

	magic.replace(/^"use strict";/, '');

	magic.appendLeft(0, `"use strict";(${callFunction}=>{\n`);
	magic.append(
		`})(${callFunctionBody}(${JSON.stringify(key)},${escapeString(
			stringsDump
		)}))`
	);

	return {
		map:
			options.sourceMap &&
			magic.generateMap({
				source: options.source,
			}),
		code: magic.toString(),
	};
}
