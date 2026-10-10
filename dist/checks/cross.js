import { DOCS, finding, runAll } from './common.js';
import { blankComments, findLine, lineOf, mask } from '../util/text.js';
import { parsePlist, pGet } from '../util/plist.js';
import { pngSize } from '../util/png.js';
import { gradleAssign } from '../util/gradle.js';
import { parseVersion, versionLt, cmpVersion } from '../util/version.js';
import { REQ } from '../versions.js';
import { yString } from '../util/yaml.js';
const SECRET_PATTERNS = [
    { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, skipFiles: /(^|\/)(google-services\.json|GoogleService-Info\.plist|firebase_options\.dart|firebase\.json)$/ },
    { name: 'Stripe live secret key', re: /\bsk_live_[0-9A-Za-z]{10,}\b/ },
    { name: 'Stripe test secret key', re: /\bsk_test_[0-9A-Za-z]{10,}\b/ },
    { name: 'Stripe restricted key', re: /\brk_live_[0-9A-Za-z]{10,}\b/ },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
    { name: 'GitHub token', re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/ },
    { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
    { name: 'OpenAI/Anthropic API key', re: /\bsk-(?:ant-api\d{2}-|proj-)[0-9A-Za-z_-]{20,}/ },
    { name: 'Twilio API key', re: /\bSK[0-9a-f]{32}\b/ },
    { name: 'SendGrid API key', re: /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b/ },
];
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|jar|aar|so|dylib|a|o|ttf|otf|woff2?|mp[34]|mov|wav|m4a|aac|jks|keystore|p12|pfx|der|cer|bin|dat|class|dex|ipa|apk|aab|realm|db|sqlite|svg|lottie|riv|glb|gltf|obj|psd|ai|sketch|fig|heic|bmp|tiff?)$/i;
const LOCK_FILES = /(^|\/)(pubspec\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Podfile\.lock|Gemfile\.lock|Cargo\.lock|composer\.lock)$/;
const MAX_SECRET_FILE = 1024 * 1024;
const PLACEHOLDER_RE = /\b(YOUR_[A-Z0-9_]*(?:KEY|ID|TOKEN|SECRET|URL|DOMAIN|APP)|<YOUR[^>\n]*>|TODO|FIXME|CHANGE_?ME|REPLACE_?ME|INSERT_[A-Z_]+_HERE|localhost|127\.0\.0\.1|10\.0\.2\.2|x{8,})\b/g;
const DEFAULT_NAMES = /^(flutter_app|flutter_application(_\d+)?|my_app|myapp|my_application|app|example|example_app|hello_world|helloworld|untitled|test_app|testapp|demo|demo_app|new_project|sample|awesomeproject|awesome_project|rnapp|rn_app|expo-app|expo_app|my-app|my_expo_app)$/i;
export function crossChecks(p) {
    const checks = [
        (o) => checkUnknownFramework(p, o),
        (o) => checkSecrets(p, o),
        (o) => checkDotenvTracked(p, o),
        (o) => checkPlaceholderConfig(p, o),
        (o) => checkIcons(p, o),
        (o) => checkName(p, o),
        (o) => checkVersionMismatch(p, o),
        (o) => checkToolchainVersion(p, o),
        (o) => checkExpo(p, o),
    ];
    return runAll(checks);
}
function checkUnknownFramework(p, out) {
    if (p.framework !== 'unknown')
        return;
    out.push(finding({
        id: 'app.unknown-framework', platform: 'both', severity: 'info',
        title: 'No Flutter, React Native or Expo project detected; only cross-platform checks ran',
        detail: `Expected pubspec.yaml with a flutter: section, app.json/app.config.* with an expo config, or package.json depending on react-native at ${p.inputPath}.`,
        fix: 'Run storelint from the app root (the folder that contains pubspec.yaml or package.json), or pass that folder as the first argument.',
    }));
}
function isScannableText(p, rel) {
    if (BINARY_EXT.test(rel) || LOCK_FILES.test(rel))
        return false;
    if (/\.min\.(js|css)$|\.map$/.test(rel))
        return false;
    if (/(^|\/)(node_modules|\.git|build|Pods|\.dart_tool)\//.test(rel))
        return false;
    const size = p.size(rel);
    return size > 0 && size <= MAX_SECRET_FILE;
}
function checkSecrets(p, out) {
    const files = p.trackedFiles().filter((f) => isScannableText(p, f));
    for (const f of files) {
        const text = p.read(f);
        if (text === null || text.includes('\u0000'))
            continue;
        for (const pat of SECRET_PATTERNS) {
            if (pat.skipFiles?.test(f))
                continue;
            const m = findLine(text, pat.re);
            if (!m)
                continue;
            const isCertFile = /\.(pem|key|p8)$/i.test(f);
            out.push(finding({
                id: 'app.secrets', platform: 'both', severity: 'blocker',
                title: `${pat.name} committed in ${f} (${mask(m.match[0])})`,
                detail: `${isCertFile ? 'A private key file' : 'A credential'} is ${p.gitAvailable ? 'tracked by git' : 'not git-ignored'} and ships inside the app bundle or repo. Anything in the APK/IPA can be extracted; Play and App Store both scan uploads for leaked keys and reviewers reject apps with exposed secrets.`,
                file: f, line: m.line,
                fix: `Remove the value from ${f}, rotate it at the provider, and load it at build time instead (--dart-define / .env with react-native-config / EAS secrets, keeping the file git-ignored). ${pat.name === 'Google API key' ? 'If this is a client key for Maps/Firebase, restrict it to your Android package + SHA-1 and iOS bundle id in Google Cloud Console.' : ''}`.trim(),
                docs: DOCS.secrets,
            }));
            break; // one finding per file is enough
        }
    }
}
function checkDotenvTracked(p, out) {
    const hits = p.trackedFiles().filter((f) => {
        const base = f.split('/').pop();
        if (!/^\.env(\..+)?$/.test(base))
            return false;
        return !/\.(example|sample|template|dist|defaults?)$/i.test(base);
    });
    for (const f of hits) {
        out.push(finding({
            id: 'app.dotenv-tracked', platform: 'both', severity: 'blocker',
            title: `${f} is ${p.gitAvailable ? 'tracked by git' : 'not git-ignored'}`,
            detail: 'Environment files hold API keys and backend URLs. Committing them leaks every credential to anyone with repo access and, with react-native-config/flutter_dotenv, bundles them into the release binary.',
            file: f,
            fix: `Run \`git rm --cached ${f}\`, add \`.env*\` (and \`!.env.example\`) to .gitignore, rotate the keys inside, and provide the values through CI/EAS secrets.`,
            docs: DOCS.secrets,
        }));
    }
}
function releaseConfigFiles(p) {
    const fixed = [
        p.appGradle, p.manifest, p.infoPlist, 'android/app/src/main/res/values/strings.xml', 'eas.json', '.env.production',
        p.expo?.file ?? null,
    ].filter((f) => !!f && p.exists(f));
    const src = p.find((f) => /^(lib|src|app|config)\/.*(^|\/)(config|constants|env|environment|api)[^/]*\.(dart|js|ts|tsx|jsx|json)$/.test(f) && !/(test|spec|__tests__)/.test(f));
    return [...new Set([...fixed, ...src])];
}
function checkPlaceholderConfig(p, out) {
    for (const f of releaseConfigFiles(p)) {
        const raw = p.read(f);
        if (raw === null)
            continue;
        const text = /\.(xml|plist|storyboard)$/.test(f) ? blankComments(raw, 'xml') : f.endsWith('.json') ? raw : blankComments(raw, 'c');
        const tokens = new Map();
        let m;
        PLACEHOLDER_RE.lastIndex = 0;
        while ((m = PLACEHOLDER_RE.exec(text))) {
            const tok = m[1];
            if (/^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/.test(tok) && /\bhttps?:\/\/localhost|NSExceptionDomains|localhost/.test(text) === false)
                continue;
            if (!tokens.has(tok))
                tokens.set(tok, lineOf(text, m.index));
        }
        // Comments in the raw file also count for TODO/FIXME in release config (they usually mark unfinished signing/keys).
        if (!tokens.size) {
            const c = findLine(raw, /\b(TODO|FIXME)\b/);
            if (c && /gradle|AndroidManifest|Info\.plist|app\.json|app\.config/.test(f))
                tokens.set(c.match[1], c.line);
        }
        if (!tokens.size)
            continue;
        const list = [...tokens.keys()].slice(0, 4).join(', ');
        const [, firstLine] = [...tokens.entries()][0];
        out.push(finding({
            id: 'app.placeholder-config', platform: /^android\//.test(f) ? 'android' : /^ios\//.test(f) ? 'ios' : 'both',
            severity: 'warning',
            title: `Placeholder value${tokens.size > 1 ? 's' : ''} in release config ${f}: ${list}`,
            detail: 'Template placeholders, TODO markers and localhost/emulator addresses in files that ship with the release build mean the app will hit a dev backend or an unset key in production, which reviewers catch immediately.',
            file: f, line: firstLine,
            fix: `Replace ${list} in ${f} with production values (or move environment-specific values to --dart-define / .env + a gitignored file) and remove dev-only ATS/cleartext exceptions before building the release.`,
        }));
    }
}
function checkIcons(p, out) {
    // Android adaptive icon
    if (p.hasAndroid) {
        const adaptive = p.find((f) => /^android\/app\/src\/main\/res\/mipmap-anydpi(-v\d+)?\/ic_launcher(_round)?\.xml$/.test(f));
        if (adaptive.length === 0) {
            out.push(finding({
                id: 'app.icons', platform: 'android', severity: 'warning',
                title: 'No adaptive launcher icon (res/mipmap-anydpi-v26/ic_launcher.xml)',
                detail: 'Android 8+ masks legacy icons into a shrunken square, which looks broken next to other apps and is a common "low quality" review note. Play also needs a 512x512 store icon.',
                file: 'android/app/src/main/res',
                fix: 'Generate adaptive icons (flutter_launcher_icons with adaptive_icon_foreground/background, or Android Studio > Image Asset) so res/mipmap-anydpi-v26/ic_launcher.xml plus foreground/background layers exist; upload a 512x512 PNG icon in Play Console.',
                docs: DOCS.androidIcons,
            }));
        }
    }
    else if (p.expoManaged) {
        const android = (p.expo.data.android ?? {});
        const fg = android.adaptiveIcon?.foregroundImage;
        const icon = android.icon ?? p.expo.data.icon;
        if (typeof fg !== 'string' || !p.exists(fg.replace(/^\.\//, ''))) {
            out.push(finding({
                id: 'app.icons', platform: 'android', severity: 'warning',
                title: typeof fg === 'string' ? `android.adaptiveIcon.foregroundImage "${fg}" does not exist` : 'No android.adaptiveIcon in app config',
                detail: `${typeof icon === 'string' ? `Only a legacy icon (${icon}) is configured; ` : 'No Android icon is configured; '}Android 8+ masks legacy icons into a shrunken square and Expo falls back to its placeholder.`,
                file: p.expo.file,
                fix: `Add \`"android": { "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png", "backgroundColor": "#ffffff" } }\` to ${p.expo.file} with a 1024x1024 PNG whose safe zone fits the inner 66%.`,
                docs: DOCS.androidIcons,
            }));
        }
    }
    // iOS 1024 marketing icon
    if (p.hasIos) {
        const sets = p.find((f) => f.startsWith('ios/') && f.endsWith('AppIcon.appiconset/Contents.json') && !f.startsWith('ios/Pods/'));
        if (sets.length === 0) {
            out.push(finding({
                id: 'app.icons', platform: 'ios', severity: 'warning',
                title: 'No AppIcon.appiconset in the iOS project',
                detail: 'App Store Connect requires a 1024x1024 App Store icon in the asset catalog (ITMS-90704) and rejects binaries without one.',
                file: 'ios',
                fix: 'Add an AppIcon image set to ios/Runner/Assets.xcassets (or the RN app folder) with a 1024x1024 PNG without alpha, and set ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon.',
                docs: DOCS.iosIcons,
            }));
        }
        else {
            const set = sets[0];
            const dir = set.replace(/\/Contents\.json$/, '');
            const json = p.json(set);
            const images = Array.isArray(json?.images) ? json.images : [];
            const marketing = images.find((i) => i && i.size === '1024x1024' && typeof i.filename === 'string' && i.filename);
            let problem = null;
            if (!marketing)
                problem = 'has no 1024x1024 entry with a filename';
            else if (!p.exists(`${dir}/${marketing.filename}`))
                problem = `references ${marketing.filename} which does not exist`;
            else {
                const dim = pngSize(p.abs(`${dir}/${marketing.filename}`));
                if (dim && (dim.width !== 1024 || dim.height !== 1024))
                    problem = `${marketing.filename} is ${dim.width}x${dim.height}, not 1024x1024`;
            }
            if (problem) {
                out.push(finding({
                    id: 'app.icons', platform: 'ios', severity: 'warning',
                    title: `AppIcon set ${problem}`,
                    detail: 'App Store Connect rejects uploads without a 1024x1024 App Store icon in the asset catalog (ITMS-90704); the icon must be opaque PNG without alpha.',
                    file: set,
                    fix: `Export a 1024x1024 opaque PNG into ${dir}/ and reference it in Contents.json as size "1024x1024", idiom "ios-marketing" (or the universal single-size entry), e.g. via flutter_launcher_icons or Xcode's asset editor.`,
                    docs: DOCS.iosIcons,
                }));
            }
        }
    }
    else if (p.expoManaged) {
        const ios = (p.expo.data.ios ?? {});
        const icon = ios.icon ?? p.expo.data.icon;
        const rel = typeof icon === 'string' ? icon.replace(/^\.\//, '') : null;
        let problem = null;
        if (!rel)
            problem = 'no icon configured (expo.icon / expo.ios.icon)';
        else if (!p.exists(rel))
            problem = `icon "${icon}" does not exist`;
        else {
            const dim = pngSize(p.abs(rel));
            if (dim && (dim.width !== 1024 || dim.height !== 1024))
                problem = `icon ${rel} is ${dim.width}x${dim.height}, not 1024x1024`;
        }
        if (problem) {
            out.push(finding({
                id: 'app.icons', platform: 'ios', severity: 'warning',
                title: `iOS app icon: ${problem}`,
                detail: 'Expo generates the AppIcon set from expo.icon, which must be a 1024x1024 PNG without transparency; otherwise App Store Connect rejects the build (ITMS-90704) or shows the Expo placeholder.',
                file: p.expo.file,
                fix: `Point expo.icon (or expo.ios.icon) in ${p.expo.file} at a 1024x1024 opaque PNG.`,
                docs: DOCS.iosIcons,
            }));
        }
    }
}
function checkName(p, out) {
    const candidates = [];
    const man = p.manifest;
    if (man) {
        const text = blankComments(p.read(man), 'xml');
        const m = findLine(text, /<application\b[^>]*android:label\s*=\s*"([^"@]+)"/);
        if (m)
            candidates.push({ name: m.match[1], file: man, line: m.line });
    }
    const plistFile = p.infoPlist;
    if (plistFile) {
        const parsed = parsePlist(p.read(plistFile));
        const dn = pGet(parsed.root, 'CFBundleDisplayName') ?? pGet(parsed.root, 'CFBundleName');
        if (typeof dn === 'string' && !dn.startsWith('$('))
            candidates.push({ name: dn, file: plistFile, line: parsed.keyLines.get('CFBundleDisplayName') ?? parsed.keyLines.get('CFBundleName') });
    }
    if (p.expoManaged && typeof p.expo.data.name === 'string')
        candidates.push({ name: p.expo.data.name, file: p.expo.file });
    for (const c of candidates) {
        const isDefault = DEFAULT_NAMES.test(c.name) || /_/.test(c.name) || (p.framework === 'flutter' && c.name === yString(p.pubspec, 'name'));
        if (!isDefault)
            continue;
        out.push(finding({
            id: 'app.name', platform: c.file.startsWith('android/') ? 'android' : c.file.startsWith('ios/') ? 'ios' : 'both', severity: 'info',
            title: `Display name "${c.name}" looks like the template default`,
            detail: 'This is the name shown under the icon on the home screen. Store listings with a placeholder app name are rejected as incomplete, and users see it immediately.',
            file: c.file, line: c.line,
            fix: `Set the real product name: android:label in AndroidManifest.xml, CFBundleDisplayName in Info.plist${p.framework === 'expo' ? ', expo.name in app.json' : ''}. Keep it under 30 characters to match the store listing title.`,
        }));
    }
}
function checkVersionMismatch(p, out) {
    const versions = [];
    const norm = (v) => v.trim().replace(/^v/, '').split('+')[0];
    if (p.framework === 'flutter') {
        const v = yString(p.pubspec, 'version');
        if (v)
            versions.push({ source: 'pubspec.yaml', file: 'pubspec.yaml', value: norm(v) });
    }
    else if (p.packageJson && typeof p.packageJson.version === 'string' && p.framework === 'react-native') {
        versions.push({ source: 'package.json', file: 'package.json', value: norm(p.packageJson.version) });
    }
    if (p.expo && typeof p.expo.data.version === 'string' && (p.hasAndroid || p.hasIos)) {
        versions.push({ source: p.expo.file, file: p.expo.file, value: norm(p.expo.data.version) });
    }
    if (versions.length === 0)
        return;
    const app = p.appGradle;
    if (app) {
        const vn = gradleAssign(blankComments(p.read(app), 'c'), 'versionName');
        const lit = vn ? /^["']([^"']+)["']$/.exec(vn.expr) : null;
        if (lit)
            versions.push({ source: 'android versionName', file: app, value: norm(lit[1]) });
    }
    const plist = p.infoPlist;
    if (plist) {
        const parsed = parsePlist(p.read(plist));
        const sv = pGet(parsed.root, 'CFBundleShortVersionString');
        if (typeof sv === 'string' && !sv.startsWith('$('))
            versions.push({ source: 'iOS CFBundleShortVersionString', file: plist, value: norm(sv) });
        else if (typeof sv === 'string' && /MARKETING_VERSION/.test(sv) && p.pbxproj) {
            const mv = /MARKETING_VERSION\s*=\s*"?([\d.]+)"?\s*;/.exec(p.read(p.pbxproj));
            if (mv)
                versions.push({ source: 'iOS MARKETING_VERSION', file: p.pbxproj, value: norm(mv[1]) });
        }
    }
    const distinct = new Set(versions.map((v) => v.value));
    if (distinct.size <= 1)
        return;
    const list = versions.map((v) => `${v.source}=${v.value}`).join(', ');
    out.push(finding({
        id: 'app.version-mismatch', platform: 'both', severity: 'info',
        title: `Version numbers disagree: ${list}`,
        detail: 'The native version strings are hard-coded instead of derived from the project version, so the store listing, crash reports and in-app "About" will show different numbers.',
        file: versions[1].file,
        fix: p.framework === 'flutter'
            ? 'Use versionName = flutter.versionName in android/app/build.gradle and $(FLUTTER_BUILD_NAME) in Info.plist so pubspec.yaml is the single source of truth.'
            : 'Keep one source of truth (package.json / app.json) and align android versionName and iOS MARKETING_VERSION with it (or let EAS/fastlane set them).',
        docs: DOCS.versionCode,
    }));
}
function checkToolchainVersion(p, out) {
    if (p.framework === 'flutter') {
        const fv = p.flutterVersion();
        if (!fv)
            return;
        const min = parseVersion(REQ.flutterMin);
        if (cmpVersion(fv.version, min) >= 0)
            return;
        const approx = fv.lowerBound ? 'appears to be' : 'is';
        out.push(finding({
            id: 'app.flutter-version', platform: 'both', severity: 'warning',
            title: `Flutter ${approx} ${fv.version.raw}${fv.lowerBound ? '+' : ''} (from ${fv.source}); ${REQ.flutterMin}+ is needed for current store requirements`,
            detail: `Flutter ${REQ.flutterMin} added privacy manifests for the engine and 3.27+ targets Android 15 with 16 KB page support; older toolchains produce bundles that fail current Play/App Store checks.${fv.lowerBound ? ' Only a lower bound is known from the SDK constraints; if you already build with a newer Flutter, raise environment.sdk in pubspec.yaml.' : ''}`,
            file: fv.source,
            fix: 'Upgrade with `flutter upgrade` (3.35+ recommended), run `flutter pub upgrade --major-versions`, then re-run storelint. Pin the version with FVM (.fvmrc) so CI and teammates match.',
            docs: DOCS.flutterVersions,
        }));
        return;
    }
    if (p.framework === 'react-native') {
        const rn = p.reactNativeVersion();
        if (!rn || !versionLt(rn, REQ.rnMin))
            return;
        out.push(finding({
            id: 'app.rn-version', platform: 'both', severity: 'warning',
            title: `react-native ${rn.raw} is below ${REQ.rnMin}; current store requirements need 0.77+`,
            detail: 'React Native below 0.73 ships AGP 7.x (no 16 KB page support, fails Play since Nov 2025), lacks privacy manifests and does not build with Xcode 26. 0.77+ ships 16 KB-aligned binaries.',
            file: 'package.json',
            fix: 'Upgrade React Native (use the Upgrade Helper at react-native-community.github.io/upgrade-helper) to 0.77 or newer, regenerate android/ and ios/ templates, and re-run storelint.',
            docs: DOCS.rnVersions,
        }));
    }
}
function checkExpo(p, out) {
    if (p.framework !== 'expo' || !p.expo)
        return;
    const cfg = p.expo;
    const ios = (cfg.data.ios ?? {});
    const android = (cfg.data.android ?? {});
    const missing = [];
    if (typeof ios.bundleIdentifier !== 'string' || !ios.bundleIdentifier)
        missing.push({ key: 'ios.bundleIdentifier', platform: 'ios' });
    if (typeof android.package !== 'string' || !android.package)
        missing.push({ key: 'android.package', platform: 'android' });
    for (const m of missing) {
        if (cfg.dynamic) {
            out.push(finding({
                id: 'app.expo', platform: m.platform, severity: 'info',
                title: `Could not verify expo.${m.key} in dynamic ${cfg.file}`,
                detail: 'app.config.js/ts is evaluated at build time and storelint does not execute it. The value may be set from environment variables.',
                file: cfg.file,
                fix: `Run \`npx expo config --type public\` and confirm ${m.key} is set; EAS Build fails without it.`,
                docs: DOCS.expoConfig,
            }));
            continue;
        }
        out.push(finding({
            id: 'app.expo', platform: m.platform, severity: 'blocker',
            title: `expo.${m.key} is missing from ${cfg.file}`,
            detail: `Without ${m.key} EAS Build / expo prebuild cannot produce a ${m.platform === 'ios' ? 'signed IPA' : 'release AAB'}, and the store cannot identify the app.`,
            file: cfg.file,
            fix: `Add \`"${m.key.split('.')[0]}": { "${m.key.split('.')[1]}": "com.yourcompany.appname" }\` under "expo" in ${cfg.file}. Use the same reverse-DNS id on both platforms; it cannot change after the first release.`,
            docs: DOCS.expoConfig,
        }));
    }
    const sdk = p.expoSdk();
    if (sdk !== null && sdk < REQ.expoMin) {
        out.push(finding({
            id: 'app.expo', platform: 'both', severity: 'warning',
            title: `Expo SDK ${sdk} is below ${REQ.expoMin}`,
            detail: 'Expo SDK 50 and older target Android 14, lack a generated iOS privacy manifest and use an AGP without 16 KB page support. EAS Build and store submission fail on them in 2026 (SDK 52+ needed for targetSdk 35, SDK 54 for 36).',
            file: 'package.json',
            fix: 'Upgrade with `npx expo install expo@latest` then `npx expo install --fix`, following the SDK upgrade walkthrough; SDK 54+ is recommended.',
            docs: DOCS.expoUpgrade,
        }));
    }
}
