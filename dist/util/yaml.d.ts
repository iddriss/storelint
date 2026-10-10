/**
 * Tiny YAML subset parser: enough for pubspec.yaml / pubspec.lock.
 * Supports nested maps, scalar values, simple lists of scalars, quotes and comments.
 * Anchors, multi-line scalars and flow mappings are not supported (values kept as strings).
 */
export type YValue = string | null | YMap | YValue[];
export interface YMap {
    [key: string]: YValue;
}
export declare function parseYaml(text: string): YMap;
export declare function yGet(node: YValue | undefined, ...path: string[]): YValue | undefined;
export declare function yString(node: YValue | undefined, ...path: string[]): string | null;
export declare function yKeys(node: YValue | undefined, ...path: string[]): string[];
