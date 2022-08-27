// babel sucks! Property.shorthand is missing in the typedefs, traverse module is incorrectly typed (it isn't a __esModule but they export using `module.export.default = traverse;`, so annoying!)

import { parse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseMod from '@babel/traverse';
import generateMod from '@babel/generator';
import * as t from '@babel/types';

const traverse = (traverseMod as unknown as { default: typeof traverseMod })
	.default;

const generate = (generateMod as unknown as { default: typeof generateMod })
	.default;

const commandPrefix = 'obfuscation:';

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

const callFunctionAST = (
	parse(`(function BasicWebpackObfuscatorCallback(key, strings, stringID){
	const input = strings[stringID];
	
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
})`).program.body[0] as t.ExpressionStatement
).expression as t.CallExpression;

export interface ObfuscateOptions {
	salt: number;
	compact: boolean;
	source: string;
	sourceMap?: boolean;
	exclude: ((identifier: string) => boolean)[];
}

export default function obfuscate(code: string, options: ObfuscateOptions) {
	const badKey = 0xfff + (options.salt % 0xfff);
	const xor = badKey >> 0x4;
	// 2-3
	const frequency = ((badKey & 0xf) % 2) + 2;

	// SHORT xor
	// CHAR frequency
	const key = (xor << 4) + frequency;

	const tree = parse(code, {
		allowAwaitOutsideFunction: true,
		allowImportExportEverywhere: true,
		allowReturnOutsideFunction: true,
		attachComment: true,
		...(options.sourceMap ? { sourceFilename: options.source } : {}),
	});

	const strings = new Map();
	const stringsArray = [];

	function appendString(string: string) {
		if (!strings.has(string)) {
			const i = stringsArray.length;
			stringsArray.push(t.stringLiteral(transformString(string, key)));
			strings.set(string, i);
		}

		return t.callExpression(t.identifier(callFunction), [
			t.numericLiteral(strings.get(string)),
		]);
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
		end?: number;
	}

	const skipObfuscation = [];

	let skipBuilding: SkipLoc | undefined;

	for (const comment of tree.comments) {
		const trimmed = comment.value.trim();

		if (trimmed.startsWith(commandPrefix)) {
			const command = trimmed.slice(commandPrefix.length);

			if (command === 'disable') {
				const loc: SkipLoc = { start: comment.end };
				skipBuilding = loc;
				skipObfuscation.push(loc);
			} else if (command === 'enable') {
				if (!skipBuilding) {
					console.warn('Unmatched :disable command');
				} else {
					skipBuilding.end = comment.start;
					skipBuilding = undefined;
				}
			}
		}
	}

	const obfuscatedNodes = new WeakSet<t.Node>();

	function willSkip(path: NodePath<t.Node>) {
		if (obfuscatedNodes.has(path.node)) return true;

		for (const loc of skipObfuscation)
			if (
				loc.start < path.node.start &&
				'end' in loc &&
				loc.end > path.node.start
			)
				return true;

		return false;
	}

	function test(identifier: string) {
		for (const test of options.exclude) {
			if (test(identifier)) return false;
		}

		return true;
	}

	traverse(tree, {
		ImportDeclaration(path) {
			path.skip();
		},
		Import(path) {
			path.skip();
		},
		TemplateLiteral(path) {
			if (willSkip(path)) return;

			const quasis = [];
			const expressions = [];

			const nodeExpressions = [...path.node.expressions];

			for (const element of path.node.quasis) {
				if (element.value.raw) {
					if (test(element.value.raw)) {
						expressions.push(appendString(element.value.raw));
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
			obfuscatedNodes.add(ast);
			path.replaceWith(ast);
		},
		Property(path) {
			if (willSkip(path)) return;

			let key: string | undefined;

			if (t.isIdentifier(path.node.key)) key = path.node.key.name;
			else if (t.isStringLiteral(path.node.key)) key = path.node.key.value;

			if (key === undefined || !test(key)) return;

			path.replaceWith(
				t.objectProperty(
					appendString(key),
					path.node.value,
					true,
					(path.node as any).shorthand,
					path.node.decorators
				)
			);
		},
		StringLiteral(path) {
			if (willSkip(path) || !test(path.node.value)) return;

			path.replaceWith(appendString(path.node.value));
		},
	});

	return generate(
		t.program([
			t.expressionStatement(
				t.callExpression(
					t.arrowFunctionExpression(
						[t.identifier(callFunction)],
						t.blockStatement(tree.program.body)
					),
					[
						t.callExpression(
							t.memberExpression(callFunctionAST, t.identifier('bind')),
							[
								t.nullLiteral(),
								t.numericLiteral(key),
								t.arrayExpression(stringsArray),
							]
						),
					]
				)
			),
		]),
		{
			compact: options.compact,
			...(options.sourceMap
				? {
						sourceMaps: true,
						sourceFilename: options.source,
				  }
				: {}),
		}
	);
}
