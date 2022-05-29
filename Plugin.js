const webpack = require('webpack');
const multimatch = require('multimatch');
const { transfer: transferSourceMap } = require('multi-stage-sourcemap');
const obfuscate = require('./obfuscate');

const allowedExtensions = ['.js', '.mjs'];

class BasicWebpackObfuscatorPlugin {
	/**
	 * 
	 * @param {{sourceMap:boolean} & import('./obfuscate.js').obfuscateOptions} options 
	 * @param {string[]} excludes 
	 */
	constructor(options = {}, excludes) {
		this.options = options;
		this.excludes = [];
		this.excludes = this.excludes.concat(excludes || []);
	}
	/**
	 * 
	 * @param {import('webpack').Compiler} compiler 
	 * @returns 
	 */
	apply(compiler) {
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

					for (let chunk of compilation.chunks) {
						for (let fileName of chunk.files) {
							if (
								this.options.sourceMap &&
								fileName.toLowerCase().endsWith('.map')
							) {
								const srcName = fileName
									.toLowerCase()
									.slice(0, fileName.length - 4);

								if (!this.shouldExclude(srcName)) {
									const transferredSourceMap = transferSourceMap({
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
								}

								continue;
							}

							const isValidExtension = allowedExtensions.some(extension =>
								fileName.toLowerCase().endsWith(extension)
							);

							if (!isValidExtension || this.shouldExclude(fileName)) {
								continue;
							}

							const asset = compilation.assets[fileName];
							const { inputSource, inputSourceMap } =
								this.extractSourceAndSourceMap(asset);

							const { code: obfuscatedSource, map: obfuscationSourceMap } = obfuscate(inputSource, {
								...this.options,
								id: chunk.contentHash.javascript,
								source: fileName,
							});

							if (this.options.sourceMap && inputSourceMap) {
								sourcemapOutput[fileName] = obfuscationSourceMap;

								const transferredSourceMap = transferSourceMap({
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
	shouldExclude(filePath) {
		return multimatch(filePath, this.excludes).length > 0;
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

exports.allowedExtensions = allowedExtensions;
exports.default = BasicWebpackObfuscatorPlugin;
