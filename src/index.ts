import type { Compiler } from 'webpack';
import webpack from 'webpack';
import { transfer } from 'multi-stage-sourcemap';
import obfuscate from './obfuscate.js';

const allowedExtensions = ['.js', '.mjs'];

export interface Options {
	sourceMap: boolean;
	compact: boolean;
	salt: number;
}

export default class BasicWebpackObfuscatorPlugin {
	options: Options;
	constructor(options?: Partial<Options>) {
		this.options = {
			sourceMap: !!options?.sourceMap,
			compact: !!options?.compact,
			salt: options?.salt || 0,
		};
	}
	/**
	 *
	 * @param {import('webpack').Compiler} compiler
	 * @returns
	 */
	apply(compiler: Compiler) {
		const isDevServer = process.argv.join('').includes('webpack-dev-server');

		if (isDevServer) {
			console.info(
				'BasicWebpackObfuscator is disabled on webpack-dev-server as the reloading scripts ',
				'and the obfuscator can interfere with each other and break the build'
			);
			return;
		}
		const pluginName = this.constructor.name;
		compiler.hooks.compilation.tap(pluginName, compilation => {
			compilation.hooks.processAssets.tap(
				{
					name: 'WebpackObfuscator',
					stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING,
				},
				assets => {
					const sourcemapOutput = {};

					const contentHashes = [];
					for (const chunk of compilation.chunks) {
						contentHashes.push(chunk.contentHash);
					}

					for (const chunk of compilation.chunks) {
						for (const fileName of chunk.files) {
							if (
								this.options.sourceMap &&
								fileName.toLowerCase().endsWith('.map')
							) {
								const srcName = fileName
									.toLowerCase()
									.slice(0, fileName.length - 4);

								const transferredSourceMap = transfer({
									fromSourceMap: sourcemapOutput[srcName],
									toSourceMap: compilation.assets[fileName].source(),
								});
								const finalSourcemap = JSON.parse(transferredSourceMap);
								finalSourcemap['sourcesContent'] = JSON.parse(
									assets[fileName].source().toString()
								)['sourcesContent'];
								assets[fileName] = new webpack.sources.RawSource(
									JSON.stringify(finalSourcemap),
									false
								);

								continue;
							}

							const isValidExtension = allowedExtensions.some(extension =>
								fileName.toLowerCase().endsWith(extension)
							);

							if (!isValidExtension) continue;

							const asset = compilation.assets[fileName];
							const { inputSource, inputSourceMap } =
								this.extractSourceAndSourceMap(asset);

							const { code: obfuscatedSource, map: obfuscationSourceMap } =
								obfuscate(inputSource, {
									sourceMap: this.options.sourceMap,
									compact: this.options.compact,
									source: fileName,
									exclude: contentHashes.map(hash => string => {
										for (const key in hash)
											if (hash[key].includes(string)) return true;
									}),
									salt: this.options.salt,
								});

							if (this.options.sourceMap && inputSourceMap) {
								sourcemapOutput[fileName] = obfuscationSourceMap;

								const transferredSourceMap = transfer({
									fromSourceMap: obfuscationSourceMap,
									toSourceMap: inputSourceMap,
								});

								const finalSourcemap = JSON.parse(transferredSourceMap);
								finalSourcemap['sourcesContent'] =
									inputSourceMap['sourcesContent'];

								assets[fileName] = new webpack.sources.SourceMapSource(
									obfuscatedSource,
									fileName,
									finalSourcemap
								);
							} else {
								assets[fileName] = new webpack.sources.RawSource(
									obfuscatedSource,
									false
								);
							}
						}
					}
				}
			);
		});
	}
	extractSourceAndSourceMap(asset) {
		if (asset.sourceAndMap) {
			const { source, map } = asset.sourceAndMap();
			return { inputSource: source, inputSourceMap: map };
		} else {
			return {
				inputSource: asset.source(),
				inputSourceMap: asset.map(),
			};
		}
	}
}
