import type { Finding, Report, ScanOptions, Summary } from './types.js';
export type { Finding, Report, ScanOptions, Summary, Platform, Severity, Framework } from './types.js';
export declare const VERSION = "0.1.0";
export declare const SHIP_URL = "https://storelint.iraaj.com/ship";
export declare function summarize(findings: Finding[]): Summary;
/**
 * Scan a Flutter / React Native / Expo project directory for store release blockers.
 * Pure over the filesystem; the only subprocess is `git ls-files` (optional).
 */
export declare function scanSync(path: string, options?: ScanOptions): Report;
export declare function scan(path: string, options?: ScanOptions): Promise<Report>;
export default scan;
