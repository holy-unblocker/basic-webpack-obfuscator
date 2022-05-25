const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const command_prefix = 'obfuscation:';

const call_function = '$CAll_string';
const call_key = '$CAll_key';
const call_strings = '$CAll_strings';

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

const {
	program: {
		body: [call_function_ast],
	},
} = parse(`
function ${call_function}(i){
	const input = ${call_strings}[i];
	const xor = ${call_key} >> 0x4;
	const frequency = ${call_key} & 0xf;

	let output = '';

	for (let i = 0; i < input.length; i++) {
		if (i % frequency === 0) {
			output += String.fromCharCode(input[i].charCodeAt() ^ xor);
		} else {
			output += input[i];
		}
	}

	return output;
}`);

/**
 *
 * @param {string} code
 * @param {number} salt
 * @param {import('@babel/generator').GeneratorOptions} generate_opts
 * @returns {import('@babel/generator').GeneratorResult}
 */
function obfuscate(code, salt, generate_opts) {
	let key;

	{
		let bad_key = 0xfff + (salt % 0xfff);
		const xor = bad_key >> 0x4;
		// 2-3
		const frequency = ((bad_key & 0xf) % 2) + 2;

		// SHORT xor
		// CHAR frequency
		key = (xor << 4) + frequency;
	}

	const tree = parse(code, {
		allowAwaitOutsideFunction: true,
		allowImportExportEverywhere: true,
		allowReturnOutsideFunction: true,
		attachComment: true,
	});

	const strings = new Map();
	const strings_array = [];
	const call_function_id = t.identifier(call_function);

	/**
	 * @param {string} string
	 * @returns {t.Node}
	 */
	function append_string(string) {
		if (!strings.has(string)) {
			const i = strings_array.length;
			strings_array.push(transform_string(string, key));
			strings.set(string, i);
		}

		return t.callExpression(call_function_id, [
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
					expressions.push(append_string(element.value.raw));
					quasis.push(t.templateElement({ raw: '' }, false));
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

			if (key !== undefined) {
				path.replaceWith(
					t.objectProperty(
						append_string(key),
						path.node.value,
						true,
						path.node.shorthand,
						path.node.decorators
					)
				);
			}
		},
		StringLiteral(path) {
			if (will_skip(path)) return;

			path.replaceWith(append_string(path.node.value));
		},
	});

	tree.program.body.unshift(
		t.variableDeclaration('const', [
			t.variableDeclarator(
				t.identifier(call_strings),
				t.arrayExpression(strings_array.map(string => t.stringLiteral(string)))
			),
			t.variableDeclarator(t.identifier(call_key), t.numericLiteral(key)),
		]),
		call_function_ast
	);

	return generate(tree, generate_opts);
}

module.exports = obfuscate;
