# basic-webpack-obfuscator

A simple solution to obfuscate the strings in your Webpack scripts. This isn't a complete obfuscator nor a good one, simple RC4 is used to "obfuscate" your strings.

## Technicals



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

