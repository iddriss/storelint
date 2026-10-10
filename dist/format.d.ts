import type { Report } from './types.js';
export interface FormatOptions {
    color: boolean;
}
export declare function useColor(stream?: {
    isTTY?: boolean;
}, env?: NodeJS.ProcessEnv, argv?: string[]): boolean;
export declare function formatPretty(report: Report, opts: FormatOptions): string;
