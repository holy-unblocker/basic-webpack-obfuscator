export const varManager = () => {
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

export const commonStrings = [
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
