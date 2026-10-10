export type Platform = 'android' | 'ios' | 'both';
export type Severity = 'blocker' | 'warning' | 'info';
export type Framework = 'flutter' | 'react-native' | 'expo' | 'unknown';
export interface Finding {
    /** Stable, namespaced kebab-case id, e.g. `android.target-sdk`. */
    id: string;
    platform: Platform;
    severity: Severity;
    title: string;
    /** Human explanation, 1-3 sentences. */
    detail: string;
    /** Path relative to the project root (posix separators). */
    file?: string;
    line?: number;
    /** Actionable fix text. */
    fix: string;
    docs?: string;
}
export interface Summary {
    blocker: number;
    warning: number;
    info: number;
    /** 100 - 25*blockers - 5*warnings, floored at 0. Always 0 when the framework is `unknown`. */
    score: number;
}
export interface Report {
    schemaVersion: 1;
    scannedAt: string;
    project: {
        path: string;
        framework: Framework;
        name: string;
    };
    summary: Summary;
    findings: Finding[];
}
export interface ScanOptions {
    /** Only keep findings for this platform (plus `both`). */
    platform?: 'android' | 'ios';
}
