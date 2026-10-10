export interface Version {
    major: number;
    minor: number;
    patch: number;
    raw: string;
}
/** Parse the first `x[.y[.z]]` found in a string (tolerates ^ ~ >= and "r28" style). */
export declare function parseVersion(input: string | null | undefined): Version | null;
export declare function cmpVersion(a: Version, b: Version): number;
export declare function versionLt(a: string | Version | null, b: string): boolean;
/** Lower bound of a dart/npm style constraint: ">=3.0.0 <4.0.0", "^3.5.0", "~52.0.0", "3.1.0". */
export declare function lowerBound(constraint: string | null | undefined): Version | null;
