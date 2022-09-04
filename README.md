# basic-webpack-obfuscator

<a href="https://www.npmjs.com/package/basic-webpack-obfuscator"><img src="https://img.shields.io/npm/v/basic-webpack-obfuscator.svg?maxAge=3600" alt="npm version" /></a>

A simple solution to "obfuscate" the strings in your Webpack scripts.

## Technicals

We hook `Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING` and modify files matching `.js` and `.mjs`.

Your strings are represented as a section of a dump of strings, each string being XORed with a key derived from the salt.

Chunks are wrapped in an IIFE with an arrow function. The first parameter is the function that deobfuscates strings.

## Usage (plugin)

You can refer to the below type definitions and examples or the source code for usage. Our TypeScript code is very verbose.

```ts
import BasicWebpackObfuscator from 'basic-webpack-obfuscator';
import type { Configuration } from 'webpack';

const webpackConfig: Configuration = {
	// ...
	optimization: {
		// ...
		minimizer: [
			// ...
			new BasicWebpackObfuscator(),
			// ...
		],
		// ...
		minimizer: [
			// ...
			new BasicWebpackObfuscator({
				sourceMap: process.env.NODE_ENV === 'production',
				salt: 777,
				allowedExtensions: ['.js'],
			}),
			// ...
		]
	},
	// ...
};
```

```ts
export interface Options {
    /**
     * If sourcemaps should be produced.
     */
    sourceMap?: boolean;
    /**
     * A salt that is used to derive the XOR keys.
     */
    salt?: number;
    /**
     * Allowed file extensions, each starting with a period.
     * @default ['.js', '.mjs']
     */
    allowedExtensions?: string[];
}

export default class BasicWebpackObfuscator implements WebpackPluginInstance {
    constructor(options?: Options);
    apply(compiler: Compiler): void;
}
```

## Usage (obfuscator)

> ⚠️ This API is unstable and may change across minor releases.

You can use the obfuscator alone to obfuscate your code. We provide an export with type definitions.

You will have to "transfer" the source map yourself. We use multi-stage-sourcemap and have a type definition for it in the source directory.

```ts
import obfuscate from 'basic-webpack-obfuscator/obfuscate';

const { code } = obfuscate('console.log("Obfuscated.");');

console.log(code);
```