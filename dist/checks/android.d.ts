import type { Finding } from '../types.js';
import type { Project } from '../project.js';
type SdkKey = 'targetSdk' | 'compileSdk' | 'minSdk';
interface SdkValue {
    value: number | null;
    /** true when `value` is a known lower bound (Flutter/Expo default for a lower-bound toolchain version). */
    lowerBound: boolean;
    expr: string;
    file?: string;
    line?: number;
    note?: string;
}
export declare function androidChecks(p: Project): Finding[];
declare function expoBuildProperties(p: Project): {
    android: Record<string, any>;
    ios: Record<string, any>;
} | null;
declare function resolveSdk(p: Project, key: SdkKey): SdkValue | null;
declare function manifestPermissions(p: Project): {
    names: string[];
    file?: string;
    line?: number;
};
export { manifestPermissions, resolveSdk, expoBuildProperties };
