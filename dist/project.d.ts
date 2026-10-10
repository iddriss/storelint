import type { Framework } from './types.js';
import { type YMap } from './util/yaml.js';
import { type Version } from './util/version.js';
export interface ExpoConfig {
    file: string;
    /** Parsed config (the `expo` object for app.json; regex-extracted subset for app.config.*). */
    data: Record<string, unknown>;
    /** True when the config is JS/TS and could only be partially read. */
    dynamic: boolean;
}
export interface ResolvedVersion {
    version: Version;
    /** true when this is a known lower bound rather than the exact version. */
    lowerBound: boolean;
    source: string;
}
export declare class Project {
    readonly root: string;
    readonly inputPath: string;
    readonly files: string[];
    readonly gitAvailable: boolean;
    readonly framework: Framework;
    readonly name: string;
    readonly pubspec: YMap | null;
    readonly pubspecLock: YMap | null;
    readonly packageJson: Record<string, any> | null;
    readonly expo: ExpoConfig | null;
    readonly easJson: Record<string, any> | null;
    private readonly tracked;
    private readonly ignore;
    private readonly cache;
    private readonly fileSet;
    constructor(inputPath: string);
    abs(rel: string): string;
    exists(rel: string): boolean;
    isDir(rel: string): boolean;
    read(rel: string): string | null;
    json(rel: string): Record<string, any> | null;
    size(rel: string): number;
    /** All walked files matching a predicate on the posix-relative path. */
    find(pred: (rel: string) => boolean): string[];
    /** First walked file matching. */
    findOne(pred: (rel: string) => boolean): string | null;
    /** Tracked by git, or (without git) present and not ignored by .gitignore. */
    isTracked(rel: string): boolean;
    trackedFiles(): string[];
    private detect;
    private detectName;
    private loadExpoConfig;
    npmDeps(): Set<string>;
    npmDepVersion(name: string): string | null;
    pubDeps(): Set<string>;
    /** Union of pub and npm dependency names. */
    deps(): Set<string>;
    hasDep(...names: string[]): boolean;
    get hasAndroid(): boolean;
    get hasIos(): boolean;
    /** Expo project without generated native folders (EAS/prebuild manages them). */
    get expoManaged(): boolean;
    flutterVersion(): ResolvedVersion | null;
    expoSdk(): number | null;
    reactNativeVersion(): Version | null;
    /** Android app-module gradle file, if any. */
    get appGradle(): string | null;
    get rootGradle(): string | null;
    get settingsGradle(): string | null;
    /** All gradle build files under android/ (excluding build dirs). */
    gradleFiles(): string[];
    /** The main AndroidManifest.xml of the app module. */
    get manifest(): string | null;
    /** iOS app Info.plist (Runner/Info.plist for Flutter, <App>/Info.plist for RN). */
    get infoPlist(): string | null;
    get pbxproj(): string | null;
    entitlementsFiles(): string[];
}
