# basic-webpack-obfuscator

A simple solution to obfuscate the strings in your Webpack scripts. This isn't a complete obfuscator nor a good one, simple RC4 is used to "obfuscate" your strings.

## Technicals

We hook `Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING` and modify files matching `.js` and `.mjs`.

## Usage

webpack.config.js:
```ts
import BasicWebpackObfuscator from 'basic-webpack-obfuscator';
import type { Configuration } from 'webpack';

const webpackConfig: Configuration = {
	// ...
	plugins: [
		new BasicWebpackObfuscator({
			sourceMap: true,
			compact: true,
		}),	
	],
	// ...
};
```

## Options

Options can be found in the type definitions (browse node_modules or just read [src/index.ts](src/index.ts)).