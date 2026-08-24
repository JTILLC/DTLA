// src/utils/srMatch.js
//
// The one normaliser for service report numbers now lives in ../shared so
// every app joins on the same definition; this file only forwards it for the
// existing import sites here.
// Relative rather than '@shared' — either resolves now that the tests run
// under vitest, which reads the alias out of vite.config.js. It was once the
// only form that worked, back when `npm test` was plain `node --test`.
export { normalizeSr, findJobsForSr } from '../../../shared/utils/srMatch.js';
export { default } from '../../../shared/utils/srMatch.js';
