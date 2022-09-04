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

const varManager = () => {
	const vars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'.split(
		''
	);
	const cache = new Map<string, string>();

	const allocate = () => {
		if (!vars.length) throw new Error('No var');
		const varI = ~~(Math.random() * vars.length);
		const result = vars[varI];
		vars.splice(varI, 1);
		return result;
	};

	return (name: string) => {
		if (!cache.has(name)) cache.set(name, allocate());
		return cache.get(name);
	};
};

const callFunctionBody = (key: number) => {
	const V = varManager();

	return (
		`(${V('dump')}=>(${V('start')},${V('end')})=>{` +
		`const ${V('input')}=${V('dump')}.slice(${V('start')},${V('end')});` +
		`let ${V('output')}='',${V('i1')}=0;` +
		`for(;${V('i1')}<${V('input')}.length;${V('i1')}++)` +
		`${V('output')}+=${V('i1')}%${key & 0xf}===0` +
		`?String.fromCharCode(${V('input')}[${V('i1')}].charCodeAt()^${
			key >> 0x4
		})` +
		`:${V('input')}[${V('i1')}];` +
		`return ${V('output')}` +
		`})`
	);
};

const commonStrings = [
	// general
	'valueOf',
	'toString',
	'toLocaleString',
	'prototype',
	'constructor',
	// Object
	'preventExtensions',
	'defineProperty',
	'defineProperties',
	'getOwnPropertyDescriptor',
	'getOwnPropertyDescriptors',
	'getOwnPropertyNames',
	'getOwnPropertySymbols',
	// object
	'__proto__',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
	'propertyIsEnumerable',
	'hasOwnProperty',
	// Regex
	'test',
	// Map/Set
	'get',
	'set',
	'add',
	'has',
	// function
	'bind',
	'call',
	'apply',
	'name',
	// number
	'toFixed',
	// String
	'fromCharCode',
	'fromCodePoint',
	// string
	'charAt',
	'charCodeAt',
	'match',
	'matchAll',
	'padStart',
	'padEnd',
	'substr',
	'substring',
	// Array/string
	'length',
	'push',
	'slice',
	'splice',
	'at',
	'fill',
	'every',
	'some',
	'concat',
	'shift',
	'unshift',
	'reverse',
	'copyWithin',
	'reduce',
	'reduceRight',
	'map',
	'pop',
	'lastIndexOf',
	'find',
	'forEach',
	'join',
	'keys',
	'entries',
	'values',
	'includes',
	'indexOf',
	// AbortController
	'abort',
	// Symbol
	'iterator',
	'toPrimitive',
	// window
	'document',
	'globalThis',
	'window',
	'self',
];

export interface ObfuscateOptions {
	salt: number;
	source: string;
	sourceMap?: boolean;
	exclude: (identifier: string) => boolean;
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

	const callFunction = `ʘẅ`;

	const appendString = (string: string) => {
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
			code: `${callFunction}(${got.start},${got.end})`,
		};
	};

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
				const loc = { start: offset };
				skipBuilding = loc;
			} else {
				if (!skipBuilding) {
					console.warn('Unmatched :disable command');
				} else {
					skipBuilding.end = offset;
					skipObfuscation.push(skipBuilding as SkipLoc);
					skipBuilding = undefined;
				}
			}
		}
	}

	const willSkip = (path: NodePath<t.Node>) => {
		for (const loc of skipObfuscation)
			if (
				loc.start < path.node.start &&
				'end' in loc &&
				loc.end > path.node.start
			)
				return true;

		return false;
	};

	/**
	 * What happens is anything less than 6 characters ends up taking more bytes to obfuscate
	 * 'test'
	 * ʘẅ(0, 4)
	 *
	 * 4 characters being ʘẅ(...)
	 *
	 * 6 characters is perfect:
	 * 'test12'
	 * ʘẅ(0, 6)
	 */
	const willSkipString = (string: string) =>
		string.length < 6 ||
		commonStrings.includes(string) ||
		(options.exclude && options.exclude(string));

	const objProp = (path: NodePath<t.ObjectProperty | t.ObjectMethod>) => {
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

		if (key === undefined || pos === undefined || willSkipString(key)) return;

		const appent = appendString(key);

		//  || path.node.method
		if (!path.node.computed) {
			// fake computed
			magic.appendLeft(pos[0], '[');
			magic.appendRight(pos[1], ']');
		}

		if (t.isObjectProperty(path.node) && path.node.shorthand)
			magic.appendRight(pos[1], ': ' + (path.node.value as t.Identifier).name);

		magic.overwrite(pos[0], pos[1], appent.code);

		if (t.isObjectProperty(path.node)) path.node.shorthand = false;
		path.node.computed = true;
		path.node.key = appent.ast;

		// cannot skip!
		// path.replaceWith(ast)[0].skip();
	};

	const templateLiterals: t.TemplateLiteral[] = [];

	traverse(tree, {
		TemplateLiteral(path) {
			if (willSkip(path)) return;

			templateLiterals.push(path.node);
		},
		MemberExpression(path) {
			// obj.'string literal...'
			// only indentifier
			// if it was string literal then the appropiate visitor will take ffect
			if (
				!t.isIdentifier(path.node.property) ||
				path.node.computed ||
				willSkipString(path.node.property.name)
			)
				return;

			const appent = appendString(path.node.property.name);

			magic.overwrite(
				path.node.property.start - 1, // the . in non-computed property access
				path.node.property.end,
				`[${appent.code}]`
			);

			path.node.computed = true;
			path.node.property = appent.ast;
		},
		ClassMethod(path) {
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

			// weird! constructor has to be an identifier or it simply isn't called
			// (new(class{['cons' + 'tructor'](){ this.test = 1; }})).test
			if (
				key === undefined ||
				pos === undefined ||
				key === 'constructor' ||
				willSkipString(key)
			)
				return;

			const appent = appendString(key);

			if (!path.node.computed) {
				// fake computed
				magic.appendLeft(pos[0], '[');
				magic.appendRight(pos[1], ']');
			}

			magic.overwrite(pos[0], pos[1], appent.code);

			// console.log(magic.slice(pos[0] - 10, pos[1] + 10));

			/*const ast = t.objectProperty(
				appent.ast,
				path.node.value,
				true,
				(path.node as any).shorthand,
				path.node.decorators
			);*/

			path.node.computed = true;
			path.node.key = appent.ast;

			// cannot skip!
			// path.replaceWith(ast)[0].skip();
		},
		ObjectProperty(path) {
			objProp(path);
		},
		ObjectMethod(path) {
			objProp(path);
		},
		StringLiteral(path) {
			if (willSkip(path) || willSkipString(path.node.value)) return;

			const appent = appendString(path.node.value);

			/*
			// does not work, ineffective:
			const padLeft = t.isSwitchCase(path.parent) ? ' ' : '';
			const padRight = t.isReturnStatement(path.parent) ? ' ' : '';
			*/

			// lazy solution:
			const padLeft = t.isValidIdentifier(
				'$' + code.slice(path.node.start - 1, path.node.start)
			)
				? ' '
				: '';
			const padRight = t.isValidIdentifier(
				'$' + code.slice(path.node.end, path.node.end + 1)
			)
				? ' '
				: '';

			magic.overwrite(
				path.node.start,
				path.node.end,
				padLeft + appent.code + padRight
			);

			path.replaceWith(appent.ast)[0].skip();
		},
	});

	for (const node of templateLiterals) {
		const quasises: t.TemplateElement[] = [];
		const expressions: (t.TSType | t.Expression)[] = [];

		for (let i = 0; i < node.quasis.length; i++) {
			const quasis = node.quasis[i];
			// for every quasis, there's an expression UNLESS ITS THE TAIL
			const expression = node.expressions[i];

			// if (quasis.value.raw) {
			if (willSkipString(quasis.value.raw)) {
				quasises.push(quasis);
				if (!quasis.tail) expressions.push(expression);
			} else {
				expressions.push(appendString(quasis.value.raw).ast);
				quasises.push(t.templateElement({ raw: '' }, quasis.tail));

				if (quasis.tail) {
					quasises.push(t.templateElement({ raw: '' }, true));
				} else {
					quasises.push(t.templateElement({ raw: '' }, false));
					expressions.push(expression);
				}
			}
			// }

			// false if .tail === true

			/*if (!element.tail) {
				expressions.push(nodeExpressions.shift());
				quasis.push(t.templateElement({ raw: '' }, false));
			}*/
		}

		// quasis.push(t.templateElement({ raw: '' }, true));

		// dont skip the entire node and children
		// keep children but dont re-process replaced node
		// path.skip()

		const ast = t.templateLiteral(quasises, expressions);

		magic.overwrite(node.start, node.end, generate(ast).code);

		/*} catch (err) {
			console.error('struggling to do', generate(node).code);
			console.error(err);
		}*/
		// path.replaceWith(ast);
	}

	magic.replace(/^"use strict";/, '');
	magic.appendLeft(0, `"use strict";(${callFunction}=>{`);
	// babel's generator can escape the string for us
	magic.append(
		`\n})(${callFunctionBody(key)}(${
			generate(t.stringLiteral(stringsDump)).code
		}))`
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
