export interface Block {
    body: string;
    /** Absolute offset of the first char of body in the original text. */
    start: number;
    end: number;
}
/** Extract the `{ ... }` body following the first match of `headerRe` (must end at the `{`). */
export declare function extractBlock(text: string, headerRe: RegExp, from?: number): Block | null;
export interface GradleValue {
    expr: string;
    line: number;
}
/** `key = value` / `key value` / `key(value)` on its own line (Groovy or Kotlin DSL). */
export declare function gradleAssign(text: string, key: string, offset?: number): GradleValue | null;
/** Parse `key=value` lines of gradle.properties. */
export declare function parseProperties(text: string): Map<string, string>;
/** Very small TOML reader for gradle/libs.versions.toml: returns [versions] and [libraries] entries. */
export declare function parseVersionsToml(text: string): {
    versions: Map<string, string>;
    libraries: Map<string, {
        module: string;
        version: string | null;
    }>;
};
