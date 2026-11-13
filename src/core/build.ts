// Set by tsup (`define`) at build time; tests and `tsx` runs see 'dev'.
declare const __BUILD_ID__: string | undefined;

/** Id of this build. A running Studio from another build is replaced by studio_open. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
