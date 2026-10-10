import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseYaml, yGet, yKeys, yString } from './util/yaml.js';
import { GitignoreMatcher } from './util/gitignore.js';
import { lowerBound, parseVersion } from './util/version.js';
import { flutterFromDart, reactNativeForExpo } from './versions.js';
const IGNORED_DIRS = new Set([
    '.git', 'node_modules', 'build', '.dart_tool', 'Pods', '.gradle', '.idea', '.vscode', 'DerivedData',
    '.expo', '.next', 'coverage', '.symlinks', '.plugin_symlinks', 'ephemeral', '.fvm', '.cxx', 'xcuserdata',
    '.kotlin', '__pycache__', '.pub-cache', '.turbo', '.cache', 'web-build', '.yarn', 'bower_components',
]);
const MAX_FILES = 100_000;
export class Project {
    root;
    inputPath;
    files;
    gitAvailable;
    framework;
    name;
    pubspec;
    pubspecLock;
    packageJson;
    expo;
    easJson;
    tracked;
    ignore;
    cache = new Map();
    fileSet;
    constructor(inputPath) {
        this.inputPath = inputPath;
        this.root = path.resolve(inputPath);
        const st = fs.statSync(this.root, { throwIfNoEntry: false });
        if (!st || !st.isDirectory())
            throw new Error(`Not a directory: ${inputPath}`);
        const { files, gitignores } = walk(this.root);
        this.files = files;
        this.fileSet = new Set(files);
        this.ignore = new GitignoreMatcher();
        for (const gi of gitignores) {
            const base = path.posix.dirname(gi);
            this.ignore.add(base === '.' ? '' : base, this.read(gi) ?? '');
        }
        // An empty result means the directory is ignored by an outer repo (or the repo has
        // no files yet); fall back to .gitignore matching so secrets/keystores are still caught.
        const git = gitListFiles(this.root);
        this.gitAvailable = git !== null && git.size > 0;
        this.tracked = this.gitAvailable ? git : null;
        this.pubspec = this.exists('pubspec.yaml') ? safe(() => parseYaml(this.read('pubspec.yaml'))) : null;
        this.pubspecLock = this.exists('pubspec.lock') ? safe(() => parseYaml(this.read('pubspec.lock'))) : null;
        this.packageJson = this.json('package.json');
        this.easJson = this.json('eas.json');
        this.expo = this.loadExpoConfig();
        this.framework = this.detect();
        this.name = this.detectName();
    }
    // ---- filesystem -------------------------------------------------------
    abs(rel) {
        return path.join(this.root, ...rel.split('/'));
    }
    exists(rel) {
        if (this.fileSet.has(rel))
            return true;
        return fs.existsSync(this.abs(rel));
    }
    isDir(rel) {
        const st = fs.statSync(this.abs(rel), { throwIfNoEntry: false });
        return !!st && st.isDirectory();
    }
    read(rel) {
        if (this.cache.has(rel))
            return this.cache.get(rel);
        let out = null;
        try {
            out = fs.readFileSync(this.abs(rel), 'utf8');
        }
        catch {
            out = null;
        }
        this.cache.set(rel, out);
        return out;
    }
    json(rel) {
        const text = this.read(rel);
        if (text === null)
            return null;
        return safe(() => JSON.parse(stripJsonComments(text)));
    }
    size(rel) {
        const st = fs.statSync(this.abs(rel), { throwIfNoEntry: false });
        return st ? st.size : 0;
    }
    /** All walked files matching a predicate on the posix-relative path. */
    find(pred) {
        return this.files.filter(pred);
    }
    /** First walked file matching. */
    findOne(pred) {
        for (const f of this.files)
            if (pred(f))
                return f;
        return null;
    }
    /** Tracked by git, or (without git) present and not ignored by .gitignore. */
    isTracked(rel) {
        if (this.tracked)
            return this.tracked.has(rel);
        return this.fileSet.has(rel) && !this.ignore.ignored(rel);
    }
    trackedFiles() {
        return this.files.filter((f) => this.isTracked(f));
    }
    // ---- detection --------------------------------------------------------
    detect() {
        if (this.pubspec && (yGet(this.pubspec, 'dependencies', 'flutter') !== undefined || yGet(this.pubspec, 'flutter') !== undefined)) {
            return 'flutter';
        }
        const deps = this.npmDeps();
        if (this.expo || deps.has('expo'))
            return 'expo';
        if (deps.has('react-native'))
            return 'react-native';
        return 'unknown';
    }
    detectName() {
        if (this.framework === 'flutter')
            return yString(this.pubspec, 'name') ?? path.basename(this.root);
        if (this.expo && typeof this.expo.data.name === 'string')
            return this.expo.data.name;
        if (this.packageJson && typeof this.packageJson.name === 'string')
            return this.packageJson.name;
        return path.basename(this.root);
    }
    loadExpoConfig() {
        const appJson = this.json('app.json');
        if (appJson && typeof appJson === 'object') {
            const data = (appJson.expo && typeof appJson.expo === 'object' ? appJson.expo : null);
            if (data)
                return { file: 'app.json', data, dynamic: false };
        }
        for (const f of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']) {
            const text = this.read(f);
            if (text === null)
                continue;
            const base = appJson?.expo ?? {};
            return { file: f, data: { ...base, ...extractExpoFromSource(text) }, dynamic: true };
        }
        return null;
    }
    // ---- dependencies -----------------------------------------------------
    npmDeps() {
        const out = new Set();
        const pj = this.packageJson;
        if (!pj)
            return out;
        for (const k of ['dependencies', 'devDependencies']) {
            const d = pj[k];
            if (d && typeof d === 'object')
                for (const n of Object.keys(d))
                    out.add(n);
        }
        return out;
    }
    npmDepVersion(name) {
        const pj = this.packageJson;
        if (!pj)
            return null;
        for (const k of ['dependencies', 'devDependencies']) {
            const v = pj[k]?.[name];
            if (typeof v === 'string')
                return v;
        }
        return null;
    }
    pubDeps() {
        const out = new Set();
        for (const k of yKeys(this.pubspec, 'dependencies'))
            out.add(k);
        return out;
    }
    /** Union of pub and npm dependency names. */
    deps() {
        const out = this.pubDeps();
        for (const d of this.npmDeps())
            out.add(d);
        return out;
    }
    hasDep(...names) {
        const d = this.deps();
        return names.some((n) => d.has(n));
    }
    // ---- native dirs ------------------------------------------------------
    get hasAndroid() {
        return this.isDir('android/app') || this.exists('android/app/build.gradle') || this.exists('android/app/build.gradle.kts');
    }
    get hasIos() {
        return this.isDir('ios') && this.find((f) => f.startsWith('ios/') && f.endsWith('.xcodeproj/project.pbxproj') && !f.includes('/Pods/')).length > 0;
    }
    /** Expo project without generated native folders (EAS/prebuild manages them). */
    get expoManaged() {
        return this.framework === 'expo' && !this.hasAndroid;
    }
    // ---- toolchain versions ----------------------------------------------
    flutterVersion() {
        const exact = (rel, pick) => {
            const t = this.read(rel);
            if (t === null)
                return null;
            const v = parseVersion(pick(t) ?? null);
            return v ? { version: v, lowerBound: false, source: rel } : null;
        };
        const fvmrc = exact('.fvmrc', (t) => safe(() => JSON.parse(t).flutter));
        if (fvmrc)
            return fvmrc;
        const fvm = exact('.fvm/fvm_config.json', (t) => safe(() => JSON.parse(t).flutterSdkVersion));
        if (fvm)
            return fvm;
        const fv = exact('.flutter-version', (t) => t.trim());
        if (fv)
            return fv;
        const tv = exact('.tool-versions', (t) => /^flutter\s+(\S+)/m.exec(t)?.[1]);
        if (tv)
            return tv;
        const bounds = [];
        const push = (c, source, viaDart = false) => {
            let v = lowerBound(c);
            if (v && viaDart)
                v = flutterFromDart(v);
            if (v)
                bounds.push({ version: v, lowerBound: true, source });
        };
        push(yString(this.pubspecLock, 'sdks', 'flutter'), 'pubspec.lock');
        push(yString(this.pubspecLock, 'sdks', 'dart'), 'pubspec.lock', true);
        push(yString(this.pubspec, 'environment', 'flutter'), 'pubspec.yaml');
        push(yString(this.pubspec, 'environment', 'sdk'), 'pubspec.yaml', true);
        if (bounds.length === 0)
            return null;
        bounds.sort((a, b) => b.version.major - a.version.major || b.version.minor - a.version.minor || b.version.patch - a.version.patch);
        return bounds[0];
    }
    expoSdk() {
        const dep = this.npmDepVersion('expo');
        const v = parseVersion(dep);
        if (v && v.major >= 30)
            return v.major;
        const sdk = this.expo?.data.sdkVersion;
        if (typeof sdk === 'string')
            return parseVersion(sdk)?.major ?? null;
        return null;
    }
    reactNativeVersion() {
        const dep = this.npmDepVersion('react-native');
        const v = parseVersion(dep);
        if (v && !(v.major === 0 && v.minor === 0))
            return v;
        const sdk = this.expoSdk();
        if (sdk !== null)
            return parseVersion(reactNativeForExpo(sdk));
        return null;
    }
    /** Android app-module gradle file, if any. */
    get appGradle() {
        if (this.exists('android/app/build.gradle.kts'))
            return 'android/app/build.gradle.kts';
        if (this.exists('android/app/build.gradle'))
            return 'android/app/build.gradle';
        return null;
    }
    get rootGradle() {
        if (this.exists('android/build.gradle.kts'))
            return 'android/build.gradle.kts';
        if (this.exists('android/build.gradle'))
            return 'android/build.gradle';
        return null;
    }
    get settingsGradle() {
        if (this.exists('android/settings.gradle.kts'))
            return 'android/settings.gradle.kts';
        if (this.exists('android/settings.gradle'))
            return 'android/settings.gradle';
        return null;
    }
    /** All gradle build files under android/ (excluding build dirs). */
    gradleFiles() {
        return this.find((f) => f.startsWith('android/') && /(^|\/)(build|settings)\.gradle(\.kts)?$/.test(f));
    }
    /** The main AndroidManifest.xml of the app module. */
    get manifest() {
        const main = 'android/app/src/main/AndroidManifest.xml';
        if (this.exists(main))
            return main;
        return this.findOne((f) => /^android\/app\/src\/main\/.*AndroidManifest\.xml$/.test(f));
    }
    /** iOS app Info.plist (Runner/Info.plist for Flutter, <App>/Info.plist for RN). */
    get infoPlist() {
        const candidates = this.find((f) => /^ios\/[^/]+\/Info\.plist$/.test(f) && !/Tests?\//.test(f) && !f.startsWith('ios/Pods/'));
        if (candidates.length === 0)
            return null;
        const runner = candidates.find((f) => f === 'ios/Runner/Info.plist');
        if (runner)
            return runner;
        const proj = this.pbxproj;
        if (proj) {
            const name = proj.split('/')[1].replace(/\.xcodeproj$/, '');
            const match = candidates.find((f) => f === `ios/${name}/Info.plist`);
            if (match)
                return match;
        }
        return candidates[0];
    }
    get pbxproj() {
        return this.findOne((f) => /^ios\/[^/]+\.xcodeproj\/project\.pbxproj$/.test(f) && !f.startsWith('ios/Pods'));
    }
    entitlementsFiles() {
        return this.find((f) => f.startsWith('ios/') && f.endsWith('.entitlements') && !f.startsWith('ios/Pods/'));
    }
}
// ---- helpers -------------------------------------------------------------
function safe(fn) {
    try {
        return fn();
    }
    catch {
        return null;
    }
}
function stripJsonComments(text) {
    // app.json / eas.json occasionally carry // comments (JSON5-ish); strip conservatively.
    return text.replace(/^\s*\/\/.*$/gm, '');
}
function walk(root) {
    const files = [];
    const gitignores = [];
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop();
        const abs = rel ? path.join(root, ...rel.split('/')) : root;
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        }
        catch {
            continue;
        }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const e of entries) {
            if (e.isSymbolicLink())
                continue;
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (IGNORED_DIRS.has(e.name))
                    continue;
                stack.push(childRel);
            }
            else if (e.isFile()) {
                if (e.name === '.gitignore')
                    gitignores.push(childRel);
                files.push(childRel);
                if (files.length >= MAX_FILES)
                    return { files, gitignores };
            }
        }
    }
    files.sort();
    return { files, gitignores };
}
/** `git ls-files` (tracked + untracked-but-not-ignored), relative to root. null if git is absent or not a repo. */
function gitListFiles(root) {
    try {
        const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 15_000,
            maxBuffer: 256 * 1024 * 1024,
        });
        const set = new Set();
        for (const p of out.split('\0'))
            if (p)
                set.add(p.replace(/\\/g, '/'));
        return set;
    }
    catch {
        return null;
    }
}
/** Best-effort extraction of static strings from app.config.js/ts without executing it. */
function extractExpoFromSource(text) {
    const out = {};
    const str = (key) => {
        const m = new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`$]+)["'\`]`).exec(text);
        return m ? m[1] : null;
    };
    const name = str('name');
    const version = str('version');
    const slug = str('slug');
    const bundleIdentifier = str('bundleIdentifier');
    const pkg = str('package');
    const sdkVersion = str('sdkVersion');
    if (name)
        out.name = name;
    if (version)
        out.version = version;
    if (slug)
        out.slug = slug;
    if (sdkVersion)
        out.sdkVersion = sdkVersion;
    if (bundleIdentifier)
        out.ios = { bundleIdentifier };
    if (pkg)
        out.android = { package: pkg };
    return out;
}
