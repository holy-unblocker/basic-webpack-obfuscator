import obfuscate from './obfuscate.js';
import { transfer } from 'multi-stage-sourcemap';
import { parse } from 'path';
import webpack from 'webpack';
import type { Compilation, Compiler, WebpackPluginInstance } from 'webpack';

// why is this not exported in the typedefs?!
type Source = Compilation['assets'][''];

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

interface NormalizedOptions {
	sourceMap: boolean;
	salt: number;
	allowedExtensions: string[];
}

export default class BasicWebpackObfuscator implements WebpackPluginInstance {
	private options: NormalizedOptions;
	constructor(options: Options = {}) {
		this.options = {
			sourceMap: !!options.sourceMap,
			salt: isNaN(options.salt) ? 0 : options.salt,
			allowedExtensions:
				Array.isArray(options.allowedExtensions) &&
				options.allowedExtensions.every(
					(value) => typeof value === 'string' && value.startsWith('.')
				)
					? options.allowedExtensions
					: ['.js', '.mjs'],
		};
	}
	apply(compiler: Compiler) {
		compiler.hooks.compilation.tap('BasicWebpackObfuscator', (compilation) => {
			compilation.hooks.processAssets.tap(
				{
					name: 'BasicWebpackObfuscator',
					stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING,
				},
				(assets) => {
					const sourcemapOutput = {};

					const contentHashes = new Set<string>();

					for (const chunk of compilation.chunks)
						for (const key in chunk.contentHash)
							contentHashes.add(chunk.contentHash[key]);

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
									toSourceMap: compilation.assets[fileName].source().toString(),
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

							if (!this.options.allowedExtensions.includes(parse(fileName).ext))
								continue;

							const asset = compilation.assets[fileName];
							const { inputSource, inputSourceMap } =
								this.extractSourceAndSourceMap(asset);

							const { code: obfuscatedSource, map: obfuscationSourceMap } =
								obfuscate(inputSource.toString(), {
									source: this.options.sourceMap && fileName,
									exclude: (string) => {
										for (const hash of contentHashes) {
											if (hash.includes(string)) return true;
										}

										return false;
									},
									salt: this.options.salt,
								});

							if (this.options.sourceMap && inputSourceMap) {
								sourcemapOutput[fileName] = obfuscationSourceMap;

								const transferredSourceMap = transfer({
									fromSourceMap: JSON.stringify(obfuscationSourceMap),
									toSourceMap: JSON.stringify(inputSourceMap),
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
	private extractSourceAndSourceMap(asset: Source) {
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
