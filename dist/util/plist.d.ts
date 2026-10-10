/** Minimal Apple XML plist parser (Info.plist, *.entitlements, PrivacyInfo.xcprivacy). */
export type PValue = string | number | boolean | PValue[] | PDict;
export interface PDict {
    [key: string]: PValue;
}
export interface ParsedPlist {
    root: PValue | null;
    /** 1-based line of each top-level <key> in the root dict. */
    keyLines: Map<string, number>;
}
export declare function parsePlist(text: string): ParsedPlist;
export declare function pGet(root: PValue | null | undefined, ...path: string[]): PValue | undefined;
export declare function pHas(root: PValue | null | undefined, key: string): boolean;
