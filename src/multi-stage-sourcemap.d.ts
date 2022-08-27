declare module 'multi-stage-sourcemap' {
	/**
	 * return re-mapped rawSourceMap string
	 */
	export function transfer(mappingObject: {
		fromSourceMap: string;
		toSourceMap: string;
	}): string;
}
