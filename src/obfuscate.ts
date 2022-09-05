// babel sucks! Property.shorthand is missing in the typedefs, traverse module is incorrectly typed (it isn't a __esModule but they export using `module.export.default = traverse;`, so annoying!)
import { commonStrings, varManager } from './util.js';
import generateMod from '@babel/generator';
import { parse } from '@babel/parser';
import type { NodePath, Visitor } from '@babel/traverse';
import traverseMod from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';
import type { SourceMap } from 'magic-string';

const traverse = (traverseMod as unknown as { default: typeof traverseMod })
	.default;

const generate = (generateMod as unknown as { default: typeof generateMod })
	.default;

const transformString = (input: string, key: number) => {
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

export interface ObfuscateOptions {
	salt?: number;
	source?: string | false;
	exclude?: (identifier: string) => boolean;
}

export interface ObfuscateResult {
	code: string;
	map: SourceMap;
}

export default function obfuscate(
	code: string,
	options: ObfuscateOptions = {}
): ObfuscateResult {
	const goodSalt = isNaN(options.salt) ? 0 : options.salt;

	const badKey = 0xfff + (goodSalt % 0xfff);
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
		...(typeof options.source === 'string'
			? { sourceFilename: options.source }
			: {}),
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

	const objProp = (
		canMagic: boolean,
		path: NodePath<t.ObjectProperty | t.ObjectMethod>
	) => {
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

		if (canMagic) {
			if (!path.node.computed) {
				// fake computed
				magic.appendLeft(pos[0], '[');
				magic.appendRight(pos[1], ']');
			}

			if (t.isObjectProperty(path.node) && path.node.shorthand)
				magic.appendRight(
					pos[1],
					': ' + (path.node.value as t.Identifier).name
				);

			magic.overwrite(pos[0], pos[1], appent.code);
		}

		if (t.isObjectProperty(path.node)) path.node.shorthand = false;
		path.node.computed = true;
		path.node.key = appent.ast;

		// cannot skip!
		// path.replaceWith(ast)[0].skip();
	};

	const createVisitors = (canMagic: boolean): Visitor => ({
		TemplateLiteral(path) {
			const quasises: t.TemplateElement[] = [];
			const expressions: (t.TSType | t.Expression)[] = [];

			for (let i = 0; i < path.node.quasis.length; i++) {
				const quasis = path.node.quasis[i];
				// for every quasis, there's an expression UNLESS ITS THE TAIL
				const expression = path.node.expressions[i];

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

			const ast = t.templateLiteral(quasises, expressions);

			if (canMagic) {
				path.scope.traverse(
					ast,
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					createVisitors(false)
				);

				magic.overwrite(path.node.start, path.node.end, generate(ast).code);
			}

			const [newPath] = path.replaceWith(ast);

			newPath.skip();

			/*} catch (err) {
			console.error('failure producting TemplateLiteral with @babel/types:');
			console.error(err);
			console.log(generate(path.node).code);
			}*/
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

			if (canMagic)
				magic.overwrite(
					path.node.property.start - 1, // the . in non-computed property access
					path.node.property.end,
					`[${appent.code}]`
				);

			path.node.computed = true;
			path.node.property = appent.ast;
		},
		ClassMethod(path) {
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

			if (canMagic) {
				if (!path.node.computed) {
					// fake computed
					magic.appendLeft(pos[0], '[');
					magic.appendRight(pos[1], ']');
				}

				magic.overwrite(pos[0], pos[1], appent.code);
			}

			path.node.computed = true;
			path.node.key = appent.ast;
		},
		ObjectProperty(path) {
			objProp(canMagic, path);
		},
		ObjectMethod(path) {
			objProp(canMagic, path);
		},
		StringLiteral(path) {
			if (willSkipString(path.node.value)) return;

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

			if (canMagic)
				magic.overwrite(
					path.node.start,
					path.node.end,
					padLeft + appent.code + padRight
				);

			path.replaceWith(appent.ast)[0].skip();
		},
	});

	traverse(tree, createVisitors(true));

	// magic.replace(/^"use strict";/, '');
	// magic.appendLeft(0, '"use strict";');
	magic.appendLeft(0, `(${callFunction}=>{`);
	// babel's generator can escape the string for us
	magic.append(
		`\n})(${callFunctionBody(key)}(${
			generate(t.stringLiteral(stringsDump)).code
		}))`
	);

	// look for sourceMappingURL
	// when this plugin is placed in optimization.minimizers, we receive code that already has the sourceMappingURL appended to it..
	// the hooks from webpack-obfuscator (what the plugin is based off) isn't ready for minimizer usage
	// console.log(code.slice(-75));

	return {
		map: magic.generateMap(
			typeof options.source === 'string'
				? {
						source: options.source,
				  }
				: {}
		),
		code: magic.toString(),
	};
}
