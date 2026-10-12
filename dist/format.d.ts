import type { Report } from './types.js';
export interface FormatOptions {
    color: boolean;
}
export declare function useColor(stream?: {
    isTTY?: boolean;
}, env?: NodeJS.ProcessEnv, argv?: string[]): boolean;
export declare function formatPretty(report: Report, opts: FormatOptions): string;
/** GitHub-flavoured Markdown report (used for the Actions job summary and PR comments). */
export declare function formatMarkdown(report: Report): string;
/**
 * GitHub Actions workflow commands: one `::error` per blocker and one `::warning` per warning,
 * so findings show inline on the pull request diff. Info findings stay in the report only.
 */
export declare function formatGithubAnnotations(report: Report, base?: string): string;
