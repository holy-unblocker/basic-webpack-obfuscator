import type { RawSourceMap } from 'source-map';

declare module 'multi-stage-sourcemap' {
	/**
	 * return re-mapped rawSourceMap string
	 */
	export function transfer(mappingObject: {
		fromSourceMap: RawSourceMap | string;
		toSourceMap: string;
	}): string;
}
