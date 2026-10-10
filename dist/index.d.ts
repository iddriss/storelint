import type { Finding, Framework, Report, ScanOptions, Summary } from './types.js';
export type { Finding, Report, ScanOptions, Summary, Platform, Severity, Framework } from './types.js';
export declare const VERSION = "0.1.1";
export declare const SHIP_URL = "https://storelint.embracetech.org/ship";
export declare function summarize(findings: Finding[], framework?: Framework): Summary;
/**
 * Scan a Flutter / React Native / Expo project directory for store release blockers.
 * Pure over the filesystem; the only subprocess is `git ls-files` (optional).
 */
export declare function scanSync(path: string, options?: ScanOptions): Report;
export declare function scan(path: string, options?: ScanOptions): Promise<Report>;
export default scan;
