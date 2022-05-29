const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const command_prefix = 'obfuscation:';

function transform_string(input, key) {
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
}

const call_function = `__BWOC_CALLBACK__`;

const {
	program: {
		body: [{ expression: call_function_ast }],
	},
} = parse(`(function BasicWebpackObfuscatorCallback(key, strings, string_id){
	const input = strings[string_id];
	
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
})`);

/**
 * 
 * @typedef {object} obfuscateOptions
 * @property {number} [salt]
 * @property {boolean} [compact]
 * @property {string} [source]
 * @property {string} [id]
 * @property {(function(): boolean)[]} [exclude]
 */

/**
 *
 * @param {string} code
 * @param {obfuscateOptions} options_
 * @returns {import('@babel/generator').GeneratorResult}
 */
function obfuscate(code, options_) {
	/**
	 * @type {obfuscateOptions}
	 */
	const options = {};

	if ('salt' in options_ && isNaN(options_.salt)) {
		options.salt = parseInt(options_.salt);
	} else {
		options.salt = 0;
	}

	if ('compact' in options_ && options_.compact) {
		options.compact = true;
	} else {
		options.compact = false;
	}

	if ('source' in options_ && options_.source) {
		options.source = String(options_.source);
	}

	if ('exclude' in options_ && options_.exclude) {
		options.exclude = options_.exclude.filter(Boolean);
	} else {
		options.exclude = [];
	}

	let key;

	{
		let bad_key = 0xfff + (options.salt % 0xfff);
		const xor = bad_key >> 0x4;
		// 2-3
		const frequency = ((bad_key & 0xf) % 2) + 2;

		// SHORT xor
		// CHAR frequency
		key = (xor << 4) + frequency;
	}

	const generate_sourcemap = 'source' in options;

	const tree = parse(code, {
		allowAwaitOutsideFunction: true,
		allowImportExportEverywhere: true,
		allowReturnOutsideFunction: true,
		attachComment: true,
		...(generate_sourcemap ? { sourceFilename: options.source } : {})
	});

	const strings = new Map();
	const strings_array = [];

	/**
	 * @param {string} string
	 * @returns {t.Node}
	 */
	function append_string(string) {
		if (!strings.has(string)) {
			const i = strings_array.length;
			strings_array.push(t.stringLiteral(transform_string(string, key)));
			strings.set(string, i);
		}

		return t.callExpression(t.identifier(call_function), [
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

	const skip_obfuscation = [];

	let skip_building;
	for (let comment of tree.comments) {
		const trimmed = comment.value.trim();

		if (trimmed.startsWith(command_prefix)) {
			const command = trimmed.slice(command_prefix.length);

			if (command === 'disable') {
				const loc = { start: comment.end };
				skip_building = loc;
				skip_obfuscation.push(loc);
			} else if (command === 'enable') {
				if (!skip_building) {
					console.warn('Unmatched :disable command');
				} else {
					skip_building.end = comment.start;
				}
			}
		}
	}

	function will_skip(path) {
		if (path.node.obfuscated) {
			return true;
		}

		for (let { start, end } of skip_obfuscation) {
			if (start < path.node.start && end > path.node.start) {
				return true;
			}
		}

		return false;
	}


	function test(string) {
		for (let test of options.exclude) {
			if (test(string)) {
				return false;
			}
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
			if (will_skip(path)) return;

			const quasis = [];
			const expressions = [];

			const node_expressions = [...path.node.expressions];

			for (let element of path.node.quasis) {
				if (element.value.raw) {
					if (test(element.value.raw)) {
						expressions.push(append_string(element.value.raw));
						quasis.push(t.templateElement({ raw: '' }, false));
					} else {
						quasis.push(t.templateElement({ raw: element.value.raw }, false));
					}
				}

				if (!element.tail) {
					expressions.push(node_expressions.shift());
					quasis.push(t.templateElement({ raw: '' }, false));
				}
			}

			quasis.push(t.templateElement({ raw: '' }, true));

			// dont skip the entire node and children
			// keep children but dont re-process replaced node
			// path.skip()

			const ast = t.templateLiteral(quasis, expressions);
			ast.obfuscated = true;

			path.replaceWith(ast);
		},
		Property(path) {
			if (will_skip(path)) return;

			let key;

			if (t.isIdentifier(path.node.key)) {
				key = path.node.key.name;
			} else if (t.isStringLiteral(path.node.key)) {
				key = path.node.key.value;
			}

			if (key === undefined || !test(key)) return;;

			path.replaceWith(
				t.objectProperty(
					append_string(key),
					path.node.value,
					true,
					path.node.shorthand,
					path.node.decorators
				)
			);

		},
		StringLiteral(path) {
			if (will_skip(path) || !test(path.node.value)) return;

			path.replaceWith(append_string(path.node.value));
		},
	});

	return generate(t.program([
		t.expressionStatement(t.callExpression(t.arrowFunctionExpression([
			t.identifier(call_function)
		], t.blockStatement(tree.program.body)), [
			t.callExpression(t.memberExpression(call_function_ast, t.identifier('bind')), [
				t.nullLiteral(),
				t.numericLiteral(key),
				t.arrayExpression(strings_array),
			])
		]))
	]), {
		compact: options.compact,
		...(generate_sourcemap ? {
			sourceMaps: true,
			sourceFilename: options.source,
		} : {})
	});
}

module.exports = obfuscate;