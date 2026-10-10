import type { Finding } from '../types.js';
import type { Project } from '../project.js';
import { DOCS, finding, runAll, type Check } from './common.js';
import { extractBlock, gradleAssign, parseProperties, parseVersionsToml } from '../util/gradle.js';
import { blankComments, findLine, lineOf } from '../util/text.js';
import { parseVersion, versionLt } from '../util/version.js';
import { REQ, agpForReactNative, expoAndroidDefaults, flutterAndroidDefaults } from '../versions.js';

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

const DANGEROUS_PERMISSIONS = [
  'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
  'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS', 'READ_CALENDAR', 'WRITE_CALENDAR', 'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'READ_MEDIA_VISUAL_USER_SELECTED',
  'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'SEND_SMS', 'RECEIVE_SMS',
  'READ_SMS', 'RECEIVE_MMS', 'BODY_SENSORS', 'BODY_SENSORS_BACKGROUND', 'ACTIVITY_RECOGNITION', 'BLUETOOTH_SCAN',
  'BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE', 'POST_NOTIFICATIONS', 'NEARBY_WIFI_DEVICES', 'MANAGE_EXTERNAL_STORAGE',
  'QUERY_ALL_PACKAGES', 'SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'USE_FULL_SCREEN_INTENT',
];

const ADS_SDKS = {
  pub: ['google_mobile_ads', 'facebook_audience_network', 'applovin_max', 'unity_ads_plugin', 'ironsource_mediation', 'admob_flutter', 'firebase_admob'],
  npm: ['react-native-google-mobile-ads', 'expo-ads-admob', 'react-native-admob', 'react-native-fbads', 'react-native-applovin-max', 'react-native-unity-ads', 'expo-ads-facebook'],
  gradle: ['com.google.android.gms:play-services-ads', 'com.facebook.android:audience-network-sdk', 'com.applovin:applovin-sdk', 'com.unity3d.ads:unity-ads'],
};

export function androidChecks(p: Project): Finding[] {
  const checks: Check[] = [
    (o) => checkTargetSdk(p, o),
    (o) => checkPageSize16Kb(p, o),
    (o) => checkMinSdk(p, o),
    (o) => checkApplicationId(p, o),
    (o) => checkDebugSigning(p, o),
    (o) => checkKeystoreInRepo(p, o),
    (o) => checkCleartext(p, o),
    (o) => checkExported(p, o),
    (o) => checkPlayCoreLegacy(p, o),
    (o) => checkAdsId(p, o),
    (o) => checkDangerousPermissions(p, o),
    (o) => checkVersionCode(p, o),
    (o) => checkProguard(p, o),
    (o) => checkPlayBilling(p, o),
  ];
  return runAll(checks);
}

// ---- SDK level resolution --------------------------------------------------

function gradleProps(p: Project): Map<string, string> {
  const t = p.read('android/gradle.properties');
  return t ? parseProperties(t) : new Map();
}

function versionsToml(p: Project) {
  const t = p.read('android/gradle/libs.versions.toml') ?? p.read('gradle/libs.versions.toml');
  return t ? parseVersionsToml(t) : null;
}

function rootExtValue(p: Project, name: string): { expr: string; file: string; line: number } | null {
  const root = p.rootGradle;
  if (!root) return null;
  const text = p.read(root)!;
  const m = new RegExp(`^[ \\t]*(?:set\\(\\s*["']${name}["']\\s*,\\s*|${name}\\s*=\\s*)([^\\n]+)`, 'm').exec(text);
  if (!m) return null;
  const expr = m[1].replace(/\/\/.*$/, '').replace(/\)\s*$/, '').trim();
  return { expr, file: root, line: lineOf(text, m.index) };
}

function expoBuildProperties(p: Project): { android: Record<string, any>; ios: Record<string, any> } | null {
  const plugins = p.expo?.data.plugins;
  if (!Array.isArray(plugins)) return null;
  for (const pl of plugins) {
    if (Array.isArray(pl) && pl[0] === 'expo-build-properties' && pl[1] && typeof pl[1] === 'object') {
      return { android: pl[1].android ?? {}, ios: pl[1].ios ?? {} };
    }
  }
  return null;
}

function evalGradleExpr(p: Project, expr: string, key: SdkKey, loc: { file?: string; line?: number }, depth = 0): SdkValue {
  const base = { expr, file: loc.file, line: loc.line };
  let e = expr.trim().replace(/\.toInteger\(\)$|\.toInt\(\)$|\.get\(\)\.toInt\(\)$/, '').replace(/^\((.*)\)$/, '$1').trim();
  const lit = /^["']?(\d+)["']?$/.exec(e);
  if (lit) return { ...base, value: Number(lit[1]), lowerBound: false };
  if (depth > 4) return { ...base, value: null, lowerBound: false, note: `could not resolve '${expr}'` };

  // flutter.targetSdkVersion / flutter.compileSdkVersion / flutter.minSdkVersion
  if (/^flutter\.(targetSdk|compileSdk|minSdk)/.test(e)) {
    const fv = p.flutterVersion();
    if (!fv) return { ...base, value: null, lowerBound: false, note: 'delegated to the Flutter SDK; Flutter version could not be determined' };
    const d = flutterAndroidDefaults(fv.version);
    return { ...base, value: d[key], lowerBound: fv.lowerBound, note: `Flutter ${fv.version.raw}${fv.lowerBound ? '+' : ''} default (from ${fv.source})` };
  }
  // Integer.parseInt(findProperty('android.targetSdkVersion') ?: '35')  (Expo prebuild)
  const fp = /findProperty\(\s*["']([\w.]+)["']\s*\)(?:\s*\?:\s*["']?(\d+)["']?)?/.exec(e) ?? /property\(\s*["']([\w.]+)["']\s*\)/.exec(e);
  if (fp) {
    const props = gradleProps(p);
    const v = props.get(fp[1]);
    if (v && /^\d+$/.test(v)) return { ...base, value: Number(v), lowerBound: false, note: `${fp[1]} from android/gradle.properties` };
    if (fp[2]) return { ...base, value: Number(fp[2]), lowerBound: false, note: `default in ${loc.file ?? 'build.gradle'}` };
  }
  // libs.versions.targetSdk / libs.versions.compileSdk
  const lv = /libs\.versions\.([\w.]+)/.exec(e);
  if (lv) {
    const toml = versionsToml(p);
    if (toml) {
      const k = lv[1];
      const v = toml.versions.get(k) ?? toml.versions.get(k.replace(/\./g, '-')) ?? toml.versions.get(k.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (v && /^\d+$/.test(v)) return { ...base, value: Number(v), lowerBound: false, note: `${k} from libs.versions.toml` };
    }
  }
  // rootProject.ext.targetSdkVersion / rootProject.targetSdkVersion / safeExtGet('targetSdkVersion', 34)
  const ext = /(?:rootProject|project)\.(?:ext\.)?(\w+)|^ext\.(\w+)|safeExtGet\(\s*["'](\w+)["']\s*(?:,\s*(\d+))?\s*\)/.exec(e);
  if (ext) {
    const name = ext[1] ?? ext[2] ?? ext[3];
    const rv = rootExtValue(p, name);
    if (rv) return evalGradleExpr(p, rv.expr, key, rv, depth + 1);
    if (ext[4]) return { ...base, value: Number(ext[4]), lowerBound: false, note: 'safeExtGet default' };
    // Expo managed/prebuilt root ext not found: fall back to gradle.properties
    const props = gradleProps(p);
    const v = props.get(`android.${name}`);
    if (v && /^\d+$/.test(v)) return { ...base, value: Number(v), lowerBound: false, note: `android.${name} from android/gradle.properties` };
  }
  // bare identifier defined in the same file: `def targetSdk = 35` / `val targetSdk = 35`
  if (/^\w+$/.test(e) && loc.file) {
    const text = p.read(loc.file) ?? '';
    const m = new RegExp(`^[ \\t]*(?:def|val|var)\\s+${e}\\s*=\\s*([^\\n]+)`, 'm').exec(text);
    if (m) return evalGradleExpr(p, m[1], key, { file: loc.file, line: lineOf(text, m.index) }, depth + 1);
    const rv = rootExtValue(p, e);
    if (rv) return evalGradleExpr(p, rv.expr, key, rv, depth + 1);
  }
  return { ...base, value: null, lowerBound: false, note: `could not resolve '${expr}'` };
}

function resolveSdk(p: Project, key: SdkKey): SdkValue | null {
  const app = p.appGradle;
  if (app) {
    const text = p.read(app)!;
    const a = gradleAssign(text, `${key}(?:Version)?`);
    if (!a) return null;
    return evalGradleExpr(p, a.expr, key, { file: app, line: a.line });
  }
  if (p.expoManaged) {
    const bp = expoBuildProperties(p);
    const override = bp?.android?.[`${key}Version`];
    if (typeof override === 'number') return { value: override, lowerBound: false, expr: `expo-build-properties ${key}Version`, file: p.expo!.file };
    const sdk = p.expoSdk();
    if (sdk === null) return null;
    return { value: expoAndroidDefaults(sdk)[key], lowerBound: false, expr: `Expo SDK ${sdk} default`, file: p.expo!.file, note: `Expo SDK ${sdk} default` };
  }
  return null;
}

// ---- checks ----------------------------------------------------------------

function checkTargetSdk(p: Project, out: Finding[]): void {
  if (!p.hasAndroid && !p.expoManaged) return;
  const t = resolveSdk(p, 'targetSdk');
  const where = p.appGradle ?? p.expo?.file ?? 'android/app/build.gradle';
  if (!t) {
    if (p.appGradle) {
      out.push(finding({
        id: 'android.target-sdk', platform: 'android', severity: 'blocker',
        title: 'targetSdk is not set; Google Play requires 35',
        detail: `No targetSdk/targetSdkVersion found in ${p.appGradle}. Without it the app targets minSdk, which Play rejects.`,
        file: p.appGradle,
        fix: `Add \`targetSdk = ${REQ.androidTargetSdk}\` (Kotlin DSL) or \`targetSdkVersion ${REQ.androidTargetSdk}\` under defaultConfig in ${p.appGradle}. Google Play requires API 35 since Aug 31 2025; API 36 for new apps and updates from Aug 31 2026 (extension to Nov 1 2026).`,
        docs: DOCS.targetSdk,
      }));
    }
    return;
  }
  if (t.value === null) {
    out.push(finding({
      id: 'android.target-sdk', platform: 'android', severity: 'info',
      title: `targetSdk could not be resolved (${t.expr})`,
      detail: `${t.note ?? 'The value is computed at build time.'} Google Play requires targetSdk ${REQ.androidTargetSdk} or higher.`,
      file: t.file, line: t.line,
      fix: `Pin the Flutter version (e.g. .fvmrc or a \`flutter:\` constraint in pubspec.yaml) or set \`targetSdk = ${REQ.androidTargetSdkNext}\` explicitly, then re-run. Flutter 3.27+ defaults to 35, 3.35+ to 36.`,
      docs: DOCS.targetSdk,
    }));
    return;
  }
  if (t.value < REQ.androidTargetSdk && !(t.lowerBound && t.value >= REQ.androidTargetSdk)) {
    if (t.lowerBound) {
      out.push(finding({
        id: 'android.target-sdk', platform: 'android', severity: 'info',
        title: `targetSdk resolves to at least ${t.value} (${t.expr}); Play requires ${REQ.androidTargetSdk}`,
        detail: `${t.note ?? ''} Only a lower bound of the Flutter version is known, so the real value may be higher.`.trim(),
        file: t.file, line: t.line,
        fix: `Build with Flutter 3.27+ (targetSdk 35) or 3.35+ (targetSdk 36), or set \`targetSdk = ${REQ.androidTargetSdkNext}\` explicitly in ${where}.`,
        docs: DOCS.targetSdk,
      }));
      return;
    }
    out.push(finding({
      id: 'android.target-sdk', platform: 'android', severity: 'blocker',
      title: `targetSdk is ${t.value}; Google Play requires ${REQ.androidTargetSdk}`,
      detail: `Google Play has rejected new apps and updates targeting below API ${REQ.androidTargetSdk} since Aug 31 2025${t.note ? ` (${t.note})` : ''}.`,
      file: t.file, line: t.line,
      fix: `Set targetSdk to ${REQ.androidTargetSdkNext} in ${where} (\`targetSdk = ${REQ.androidTargetSdkNext}\` / \`targetSdkVersion ${REQ.androidTargetSdkNext}\`), bump compileSdk to match, and re-test runtime permission and foreground-service behaviour on Android 15/16. ${REQ.androidTargetSdk} is the absolute minimum; ${REQ.androidTargetSdkNext} is required for new apps and updates from Aug 31 2026 (extension until Nov 1 2026).`,
      docs: DOCS.targetSdk,
    }));
  } else if (t.value === REQ.androidTargetSdk && !t.lowerBound) {
    out.push(finding({
      id: 'android.target-sdk', platform: 'android', severity: 'warning',
      title: `targetSdk is ${t.value}; Play requires ${REQ.androidTargetSdkNext} for new apps and updates from Aug 31 2026`,
      detail: `API ${REQ.androidTargetSdk} satisfied the 2025 deadline. From Aug 31 2026 (Nov 1 2026 with an extension) Play requires targetSdk ${REQ.androidTargetSdkNext}.`,
      file: t.file, line: t.line,
      fix: `Set targetSdk = ${REQ.androidTargetSdkNext} and compileSdk = ${REQ.androidTargetSdkNext} in ${where}, then test on Android 16 (predictive back, edge-to-edge enforced).`,
      docs: DOCS.targetSdk,
    }));
  }

  const c = resolveSdk(p, 'compileSdk');
  if (c && c.value !== null && c.value < REQ.androidCompileSdk && !c.lowerBound) {
    out.push(finding({
      id: 'android.target-sdk', platform: 'android', severity: 'warning',
      title: `compileSdk is ${c.value}; use ${REQ.androidCompileSdk} or higher`,
      detail: `compileSdk must be at least targetSdk. Modern AndroidX and Play libraries also require compileSdk ${REQ.androidCompileSdk}+.`,
      file: c.file, line: c.line,
      fix: `Set compileSdk = ${REQ.androidTargetSdkNext} in ${where} and update AGP if the build complains.`,
      docs: DOCS.targetSdk,
    }));
  }
}

function resolveAgp(p: Project): { version: string | null; file?: string; line?: number; source: string } {
  const settings = p.settingsGradle;
  if (settings) {
    const text = p.read(settings)!;
    const m = findLine(text, /id\s*\(?\s*["']com\.android\.application["']\s*\)?\s*version\s*\(?\s*["']([\d.]+)["']/);
    if (m) return { version: m.match[1], file: settings, line: m.line, source: 'settings.gradle plugins block' };
  }
  const root = p.rootGradle;
  if (root) {
    const text = p.read(root)!;
    const m = findLine(text, /com\.android\.tools\.build:gradle:([\d.]+)/);
    if (m) return { version: m.match[1], file: root, line: m.line, source: 'buildscript classpath' };
    const pl = findLine(text, /id\s*\(?\s*["']com\.android\.application["']\s*\)?\s*version\s*\(?\s*["']([\d.]+)["']/);
    if (pl) return { version: pl.match[1], file: root, line: pl.line, source: 'plugins block' };
  }
  const toml = versionsToml(p);
  if (toml) {
    for (const k of ['agp', 'android-gradle-plugin', 'androidGradlePlugin', 'android-plugin', 'gradle-plugin', 'androidPlugin']) {
      const v = toml.versions.get(k);
      if (v) return { version: v, file: 'android/gradle/libs.versions.toml', source: `libs.versions.toml ${k}` };
    }
  }
  // React Native: AGP comes from @react-native/gradle-plugin
  const rnToml = p.read('node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml');
  if (rnToml) {
    const v = /^agp\s*=\s*["']([\d.]+)["']/m.exec(rnToml);
    if (v) return { version: v[1], source: '@react-native/gradle-plugin' };
  }
  const rn = p.reactNativeVersion();
  if (rn && (p.framework === 'react-native' || p.framework === 'expo')) {
    const v = agpForReactNative(rn);
    if (v) return { version: v, file: 'package.json', source: `React Native ${rn.raw} bundled gradle plugin` };
  }
  return { version: null, source: 'unknown' };
}

function hasOwnNativeCode(p: Project): boolean {
  const app = p.appGradle;
  if (app && /externalNativeBuild|cmake\s*\{|ndkBuild\s*\{/.test(p.read(app) ?? '')) return true;
  return p.find((f) => /^android\/app\/src\/main\/(cpp|jni)\//.test(f)).length > 0;
}

function checkPageSize16Kb(p: Project, out: Finding[]): void {
  if (!p.hasAndroid && !p.expoManaged) return;
  const agp = resolveAgp(p);
  if (agp.version && versionLt(agp.version, REQ.agpFor16Kb)) {
    out.push(finding({
      id: 'android.page-size-16kb', platform: 'android', severity: 'blocker',
      title: `Android Gradle Plugin ${agp.version} cannot produce 16 KB page-aligned native libraries (need ${REQ.agpFor16Kb}+)`,
      detail: `Google Play requires 16 KB page size support for all new apps and updates targeting Android 15+ since Nov 1 2025. AGP ${agp.version} (${agp.source}) does not align or uncompress native .so files correctly${p.framework === 'flutter' ? '; Flutter apps always ship native code (libflutter.so, libapp.so)' : ''}.`,
      file: agp.file, line: agp.line,
      fix: agp.source.startsWith('React Native')
        ? `Upgrade React Native to 0.77 or newer (ships AGP 8.7+), or pin \`com.android.application\` to ${REQ.agpFor16Kb}+ in android/build.gradle. Then verify with \`zipalign -c -P 16 -v 4 app.apk\`.`
        : `Set the Android Gradle Plugin to 8.7.0 or newer (e.g. \`id "com.android.application" version "8.9.1" apply false\` in android/settings.gradle, or the classpath in android/build.gradle) and Gradle wrapper to 8.9+. Rebuild and verify with \`zipalign -c -P 16 -v 4 app.apk\`.`,
      docs: DOCS.pageSize,
    }));
  } else if (!agp.version && p.hasAndroid) {
    out.push(finding({
      id: 'android.page-size-16kb', platform: 'android', severity: 'info',
      title: 'Android Gradle Plugin version could not be determined',
      detail: 'Play requires 16 KB page-aligned native libraries since Nov 1 2025, which needs AGP 8.5.1 or newer. No AGP version was found in settings.gradle, build.gradle or libs.versions.toml.',
      file: p.settingsGradle ?? p.rootGradle ?? undefined,
      fix: `Make sure the Android Gradle Plugin is ${REQ.agpFor16Kb} or newer (8.7+ recommended) and verify the built APK with \`zipalign -c -P 16 -v 4 app.apk\`.`,
      docs: DOCS.pageSize,
    }));
  }

  // NDK: only matters when the app compiles its own native code.
  const app = p.appGradle;
  if (!app) return;
  const text = p.read(app)!;
  const ndk = gradleAssign(text, 'ndkVersion');
  if (!ndk || /flutter\.ndkVersion/.test(ndk.expr)) return;
  let ndkStr: string | null = null;
  let loc: { file: string; line: number } = { file: app, line: ndk.line };
  const lit = /^["']([\d.]+)["']$/.exec(ndk.expr);
  if (lit) ndkStr = lit[1];
  else {
    const ext = /(?:rootProject|project)\.(?:ext\.)?(\w+)/.exec(ndk.expr);
    const rv = ext ? rootExtValue(p, ext[1]) : null;
    if (rv) {
      const l2 = /^["']([\d.]+)["']$/.exec(rv.expr);
      if (l2) {
        ndkStr = l2[1];
        loc = rv;
      }
    }
  }
  const nv = parseVersion(ndkStr);
  if (nv && nv.major < REQ.ndkFor16Kb && hasOwnNativeCode(p)) {
    out.push(finding({
      id: 'android.page-size-16kb', platform: 'android', severity: 'blocker',
      title: `NDK r${nv.major} compiles native code with 4 KB page alignment (need r${REQ.ndkFor16Kb}+)`,
      detail: `This app builds its own native code (externalNativeBuild/cpp). NDK ${ndkStr} defaults to 4 KB ELF alignment, which Play rejects for Android 15+ targets since Nov 1 2025.`,
      file: loc.file, line: loc.line,
      fix: `Set \`ndkVersion = "28.0.13004108"\` (or newer) in ${app}, or keep the current NDK and add \`-Wl,-z,max-page-size=16384\` to your linker flags. Verify with \`check_elf_alignment.sh\` from the Android NDK.`,
      docs: DOCS.pageSize,
    }));
  }
}

function checkMinSdk(p: Project, out: Finding[]): void {
  if (!p.hasAndroid && !p.expoManaged) return;
  const m = resolveSdk(p, 'minSdk');
  if (!m || m.value === null || m.lowerBound) return;
  if (m.value < REQ.androidMinSdk) {
    out.push(finding({
      id: 'android.min-sdk', platform: 'android', severity: 'warning',
      title: `minSdk is ${m.value}; raise it to ${REQ.androidMinSdk} or higher`,
      detail: 'Flutter, React Native and most Play/Firebase libraries no longer support API levels below 21. Devices below Android 5 cannot run current Google Play services.',
      file: m.file, line: m.line,
      fix: `Set minSdk = ${REQ.androidMinSdk} (or 23/24 if your dependencies require it) in ${m.file ?? 'android/app/build.gradle'}.`,
      docs: DOCS.targetSdk,
    }));
  }
}

function checkApplicationId(p: Project, out: Finding[]): void {
  const app = p.appGradle;
  if (app) {
    const text = p.read(app)!;
    const m = findLine(text, /^[ \t]*applicationId\s*(?:=|\s)\s*["']([^"']+)["']/m);
    if (m && /^com\.example(\.|$)/.test(m.match[1])) {
      out.push(finding({
        id: 'android.application-id', platform: 'android', severity: 'blocker',
        title: `applicationId "${m.match[1]}" uses the reserved com.example namespace`,
        detail: 'Google Play refuses to create an app with a com.example.* package name; it is reserved for samples.',
        file: app, line: m.line,
        fix: `Change applicationId (and namespace) in ${app} to a domain you control, e.g. com.yourcompany.appname, before the first upload. The id cannot be changed after publishing.`,
        docs: DOCS.flutterRelease,
      }));
    }
    return;
  }
  if (p.expoManaged) {
    const pkg = (p.expo!.data.android as Record<string, unknown> | undefined)?.package;
    if (typeof pkg === 'string' && /^com\.example(\.|$)/.test(pkg)) {
      out.push(finding({
        id: 'android.application-id', platform: 'android', severity: 'blocker',
        title: `android.package "${pkg}" uses the reserved com.example namespace`,
        detail: 'Google Play refuses com.example.* package names.',
        file: p.expo!.file,
        fix: `Set expo.android.package in ${p.expo!.file} to a reverse-domain id you control, e.g. com.yourcompany.appname.`,
        docs: DOCS.expoConfig,
      }));
    }
  }
}

function releaseBlock(text: string) {
  const bt = extractBlock(text, /\bbuildTypes\s*\{/);
  if (!bt) return null;
  const rel = extractBlock(bt.body, /(?:\brelease|getByName\(\s*["']release["']\s*\)|create\(\s*["']release["']\s*\)|named\(\s*["']release["']\s*\))\s*\{/);
  if (!rel) return null;
  return { body: rel.body, start: bt.start + rel.start };
}

function checkDebugSigning(p: Project, out: Finding[]): void {
  const app = p.appGradle;
  if (!app) return;
  const text = blankComments(p.read(app)!, 'c');
  const rel = releaseBlock(text);
  const easManaged = p.framework === 'expo' && p.easJson !== null;
  const severity = easManaged ? 'warning' : 'blocker';
  const easNote = easManaged ? ' EAS Build injects its own credentials, so this only matters for local `gradlew bundleRelease` builds.' : '';
  if (!rel) {
    out.push(finding({
      id: 'android.debug-signing', platform: 'android', severity,
      title: 'No release buildType with a signingConfig',
      detail: `${app} has no buildTypes.release block, so release builds are signed with the debug key (or not at all). Play rejects debug-signed bundles.${easNote}`,
      file: app,
      fix: `Add a signingConfigs.release block reading key.properties (storeFile/storePassword/keyAlias/keyPassword) and \`buildTypes { release { signingConfig = signingConfigs.release } }\` in ${app}.`,
      docs: DOCS.signing,
    }));
    return;
  }
  const sc = /signingConfig\s*(?:=|\s)\s*signingConfigs\.(?:getByName\(\s*["'](\w+)["']\s*\)|(\w+))/.exec(rel.body);
  const name = sc ? (sc[1] ?? sc[2]) : null;
  const line = sc ? lineOf(text, rel.start + sc.index) : lineOf(text, rel.start);
  if (!sc) {
    out.push(finding({
      id: 'android.debug-signing', platform: 'android', severity,
      title: 'Release buildType has no signingConfig',
      detail: `The release block in ${app} does not reference a signingConfig, so the bundle is unsigned or debug-signed; Play Console rejects it.${easNote}`,
      file: app, line,
      fix: `Create an upload keystore (\`keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload\`), reference it from a git-ignored android/key.properties, and set \`signingConfig = signingConfigs.release\` inside buildTypes.release in ${app}.`,
      docs: DOCS.signing,
    }));
  } else if (name === 'debug') {
    out.push(finding({
      id: 'android.debug-signing', platform: 'android', severity,
      title: 'Release buildType is signed with signingConfigs.debug',
      detail: `Release bundles are signed with the debug keystore. Google Play rejects debug-signed APKs/AABs, and you can never rotate away from the debug key.${easNote}`,
      file: app, line,
      fix: `Create an upload keystore, add a signingConfigs.release block that reads android/key.properties (keep key.properties and *.jks out of git), and change \`signingConfig signingConfigs.debug\` to \`signingConfig signingConfigs.release\` in ${app}.`,
      docs: DOCS.signing,
    }));
  }
}

function checkKeystoreInRepo(p: Project, out: Finding[]): void {
  const hits = p.trackedFiles().filter((f) => {
    const base = f.split('/').pop()!;
    if (/^debug\.keystore$/i.test(base)) return false; // public RN debug key
    return /\.(jks|keystore)$/i.test(base) || base === 'key.properties' || base === 'keystore.properties';
  });
  for (const f of hits) {
    const isProps = f.endsWith('.properties');
    out.push(finding({
      id: 'android.keystore-in-repo', platform: 'android', severity: 'blocker',
      title: `${isProps ? 'Signing credentials' : 'Keystore'} ${f} is ${p.gitAvailable ? 'tracked by git' : 'not git-ignored'}`,
      detail: isProps
        ? 'key.properties holds the keystore password and alias in plain text. Anyone with repo access can sign releases as you; Play cannot revoke a leaked upload key without a manual reset.'
        : 'A signing keystore committed to the repository is a secret leak: anyone with repo access can sign releases as you.',
      file: f,
      fix: `Run \`git rm --cached ${f}\`, add ${isProps ? '`key.properties`' : '`*.jks` and `*.keystore`'} to .gitignore, rotate the key (request an upload-key reset in Play Console if it was ever pushed), and inject the keystore via CI secrets instead.`,
      docs: DOCS.signing,
    }));
  }
}

function checkCleartext(p: Project, out: Finding[]): void {
  const man = p.manifest;
  if (man) {
    const text = blankComments(p.read(man)!, 'xml');
    const m = findLine(text, /android:usesCleartextTraffic\s*=\s*"true"/);
    if (m) {
      out.push(finding({
        id: 'android.cleartext', platform: 'android', severity: 'warning',
        title: 'usesCleartextTraffic="true" allows unencrypted HTTP',
        detail: 'Play review and the Data Safety form expect data in transit to be encrypted. Cleartext is blocked by default since API 28; enabling it globally is a common rejection/flag reason.',
        file: man, line: m.line,
        fix: `Remove android:usesCleartextTraffic from ${man} (or set it to false). If a specific host must use HTTP, allow only that domain via a networkSecurityConfig with <domain-config cleartextTrafficPermitted="true">.`,
        docs: DOCS.cleartext,
      }));
    }
    return;
  }
  if (p.expoManaged) {
    const bp = expoBuildProperties(p);
    if (bp?.android?.usesCleartextTraffic === true) {
      out.push(finding({
        id: 'android.cleartext', platform: 'android', severity: 'warning',
        title: 'expo-build-properties enables usesCleartextTraffic',
        detail: 'Cleartext HTTP is allowed app-wide, which Play review flags and which contradicts an "encrypted in transit" Data Safety answer.',
        file: p.expo!.file,
        fix: `Remove \`android.usesCleartextTraffic: true\` from the expo-build-properties plugin config in ${p.expo!.file} and use HTTPS endpoints.`,
        docs: DOCS.cleartext,
      }));
    }
  }
}

function checkExported(p: Project, out: Finding[]): void {
  const man = p.manifest;
  if (!man) return;
  const text = blankComments(p.read(man)!, 'xml');
  const re = /<(activity|activity-alias|service|receiver)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, tag, attrs, self] = m;
    if (self === '/') continue;
    const close = text.indexOf(`</${tag}>`, m.index);
    const segment = text.slice(m.index, close < 0 ? text.length : close);
    if (!/<intent-filter\b/.test(segment)) continue;
    if (/android:exported\s*=/.test(attrs)) continue;
    const name = /android:name\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? tag;
    out.push(finding({
      id: 'android.exported', platform: 'android', severity: 'blocker',
      title: `<${tag}> ${name} has an intent-filter but no android:exported`,
      detail: 'Since Android 12 (API 31) every component with an intent-filter must declare android:exported explicitly; otherwise the APK/AAB fails to install and Play rejects the upload.',
      file: man, line: lineOf(text, m.index),
      fix: `Add android:exported="true" (if other apps or the launcher must start it, e.g. the main activity) or android:exported="false" to the <${tag} android:name="${name}"> element in ${man}.`,
      docs: DOCS.exported,
    }));
  }
}

function checkPlayCoreLegacy(p: Project, out: Finding[]): void {
  for (const f of p.gradleFiles()) {
    const text = blankComments(p.read(f)!, 'c');
    const m = findLine(text, /["']com\.google\.android\.play:core(?:-ktx)?(?::[^"']*)?["']/);
    if (m) {
      out.push(finding({
        id: 'android.play-core-legacy', platform: 'android', severity: 'warning',
        title: 'Legacy com.google.android.play:core dependency',
        detail: 'The monolithic Play Core library is incompatible with targetSdk 34+ (broken PendingIntent flags) and Play Console rejects bundles that include it when targeting API 34 or higher.',
        file: f, line: m.line,
        fix: `Replace com.google.android.play:core in ${f} with the split libraries: com.google.android.play:app-update:2.1.0, com.google.android.play:review:2.0.2, com.google.android.play:feature-delivery:2.1.0 and/or com.google.android.play:asset-delivery:2.3.0 (and update Kotlin imports to the new packages).`,
        docs: DOCS.playCore,
      }));
    }
  }
}

function manifestPermissions(p: Project): { names: string[]; file?: string; line?: number } {
  const man = p.manifest;
  if (man) {
    const text = blankComments(p.read(man)!, 'xml');
    const names: string[] = [];
    const re = /<uses-permission(?:-sdk-23)?\b[^>]*android:name\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    let first: number | undefined;
    while ((m = re.exec(text))) {
      names.push(m[1]);
      if (first === undefined) first = lineOf(text, m.index);
    }
    return { names, file: man, line: first };
  }
  if (p.expoManaged) {
    const perms = (p.expo!.data.android as Record<string, unknown> | undefined)?.permissions;
    if (Array.isArray(perms)) return { names: perms.filter((x): x is string => typeof x === 'string'), file: p.expo!.file };
  }
  return { names: [] };
}

function adsSdkPresent(p: Project): string | null {
  const deps = p.deps();
  for (const d of [...ADS_SDKS.pub, ...ADS_SDKS.npm]) if (deps.has(d)) return d;
  for (const f of p.gradleFiles()) {
    const text = p.read(f) ?? '';
    for (const g of ADS_SDKS.gradle) if (text.includes(g)) return g;
  }
  return null;
}

function checkAdsId(p: Project, out: Finding[]): void {
  if (!p.hasAndroid && !p.expoManaged) return;
  const perms = manifestPermissions(p);
  const hasAdId = perms.names.some((n) => n.endsWith('.permission.AD_ID'));
  const ads = adsSdkPresent(p);
  if (hasAdId && !ads) {
    out.push(finding({
      id: 'android.ads-id', platform: 'android', severity: 'warning',
      title: 'AD_ID permission declared but no ads SDK detected',
      detail: 'Declaring com.google.android.gms.permission.AD_ID means you must answer "Yes, uses advertising ID" in the Play Console and justify it in the Data Safety form; a mismatch gets the listing flagged.',
      file: perms.file, line: perms.line,
      fix: 'Either remove the AD_ID <uses-permission> (add tools:node="remove" if a library merges it in) or declare advertising-ID usage honestly in Play Console > App content > Advertising ID.',
      docs: DOCS.adId,
    }));
  } else if (ads && !hasAdId) {
    out.push(finding({
      id: 'android.ads-id', platform: 'android', severity: 'warning',
      title: `Ads SDK (${ads}) present but AD_ID permission is not declared in your manifest`,
      detail: 'Apps targeting Android 13+ must declare com.google.android.gms.permission.AD_ID to read the advertising ID. Ads SDKs usually merge it in, but Play Console still asks you to declare advertising-ID use and reflect it in Data Safety.',
      file: perms.file,
      fix: `Add <uses-permission android:name="com.google.android.gms.permission.AD_ID"/> to ${perms.file ?? 'AndroidManifest.xml'} (or expo.android.permissions), then set "Advertising ID: Yes" and "Collects device or other IDs" in Play Console > App content.`,
      docs: DOCS.adId,
    }));
  }
}

function checkDangerousPermissions(p: Project, out: Finding[]): void {
  const perms = manifestPermissions(p);
  const dangerous = perms.names
    .map((n) => n.replace(/^android\.permission\./, ''))
    .filter((n) => DANGEROUS_PERMISSIONS.includes(n));
  if (dangerous.length === 0) return;
  const uniq = [...new Set(dangerous)];
  out.push(finding({
    id: 'android.permissions-dangerous', platform: 'android', severity: 'info',
    title: `Declares ${uniq.length} runtime/sensitive permission${uniq.length === 1 ? '' : 's'}: ${uniq.join(', ')}`,
    detail: 'Each of these must be reflected in the Play Data Safety form and, for location/SMS/call-log/all-files access, justified in a permissions declaration or Play rejects the release.',
    file: perms.file, line: perms.line,
    fix: `Confirm every permission is still needed, remove unused ones, and declare the matching data types in Play Console > App content > Data safety. ${uniq.some((n) => /SMS|CALL_LOG|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|BACKGROUND_LOCATION/.test(n)) ? 'SMS/Call-log/All-files/Background-location/Query-all-packages need a policy declaration form with a video demo.' : ''}`.trim(),
    docs: DOCS.dataSafety,
  }));
}

function checkVersionCode(p: Project, out: Finding[]): void {
  const app = p.appGradle;
  if (app) {
    const text = blankComments(p.read(app)!, 'c');
    const vc = gradleAssign(text, 'versionCode');
    if (!vc) {
      out.push(finding({
        id: 'android.version-code', platform: 'android', severity: 'info',
        title: 'versionCode is not set in the Android build file',
        detail: 'Without a versionCode Gradle defaults to 1, and every subsequent upload must be strictly higher than the previous one.',
        file: app,
        fix: `Add \`versionCode\` under defaultConfig in ${app} (Flutter: \`versionCode = flutter.versionCode\` driven by the \`+N\` build number in pubspec.yaml).`,
        docs: DOCS.versionCode,
      }));
      return;
    }
    if (/flutter\.versionCode|flutterVersionCode/.test(vc.expr) && p.framework === 'flutter') {
      const version = typeof p.pubspec?.version === 'string' ? p.pubspec.version : null;
      const build = version ? /\+(\d+)/.exec(version)?.[1] : undefined;
      if (!build) {
        out.push(finding({
          id: 'android.version-code', platform: 'android', severity: 'info',
          title: `pubspec version "${version ?? ''}" has no +build number; versionCode falls back to 1`,
          detail: 'Flutter derives versionCode from the number after "+" in pubspec.yaml. Without it every build is versionCode 1 and the second Play upload is rejected as a duplicate.',
          file: 'pubspec.yaml',
          fix: 'Use version: 1.0.0+1 in pubspec.yaml and bump the build number on every upload (or pass --build-number in CI).',
          docs: DOCS.versionCode,
        }));
      }
    }
    return;
  }
  if (p.expoManaged) {
    const android = p.expo!.data.android as Record<string, unknown> | undefined;
    const auto = JSON.stringify(p.easJson ?? {}).includes('"autoIncrement"');
    const remote = JSON.stringify(p.easJson ?? {}).includes('"appVersionSource":"remote"') || JSON.stringify(p.easJson ?? {}).includes('"appVersionSource": "remote"');
    if (!android?.versionCode && !auto && !remote) {
      out.push(finding({
        id: 'android.version-code', platform: 'android', severity: 'info',
        title: 'No android.versionCode in app config and no EAS autoIncrement',
        detail: 'Expo defaults versionCode to 1. Each Play upload must have a higher versionCode than the last.',
        file: p.expo!.file,
        fix: `Set expo.android.versionCode in ${p.expo!.file} or enable \`"autoIncrement": true\` / \`"appVersionSource": "remote"\` in eas.json.`,
        docs: DOCS.versionCode,
      }));
    }
  }
}

function checkProguard(p: Project, out: Finding[]): void {
  const app = p.appGradle;
  if (!app) return;
  const text = blankComments(p.read(app)!, 'c');
  const rel = releaseBlock(text);
  if (!rel) return;
  const m = /(?:isMinifyEnabled\s*=\s*true|minifyEnabled\s*(?:=\s*)?true)/.exec(rel.body);
  if (!m) return;
  if (p.exists('android/app/proguard-rules.pro')) return;
  const refs = /proguardFiles[^\n]*["']([^"']*\.pro)["']/.exec(rel.body);
  if (refs && p.exists(`android/app/${refs[1]}`)) return;
  out.push(finding({
    id: 'android.proguard', platform: 'android', severity: 'warning',
    title: 'minifyEnabled is true but android/app/proguard-rules.pro is missing',
    detail: 'R8 will strip or rename classes reached by reflection (Flutter plugins, Firebase, Gson, RN modules). Release builds then crash on launch while debug builds work, a classic rejection cause.',
    file: app, line: lineOf(text, rel.start + m.index),
    fix: `Create android/app/proguard-rules.pro with keep rules for your plugins (e.g. \`-keep class io.flutter.** { *; }\` for Flutter, plus rules from each SDK's README) and reference it via proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"). Test the release build on a device.`,
    docs: DOCS.proguard,
  }));
}

function checkPlayBilling(p: Project, out: Finding[]): void {
  const hits: { version: string; file: string; line?: number }[] = [];
  for (const f of p.gradleFiles()) {
    const text = blankComments(p.read(f)!, 'c');
    const m = findLine(text, /com\.android\.billingclient:billing(?:-ktx)?:([\d.]+)/);
    if (m) hits.push({ version: m.match[1], file: f, line: m.line });
  }
  const toml = versionsToml(p);
  if (toml) {
    for (const [, lib] of toml.libraries) {
      if (lib.module.startsWith('com.android.billingclient:billing') && lib.version) hits.push({ version: lib.version, file: 'android/gradle/libs.versions.toml' });
    }
  }
  for (const h of hits) {
    const v = parseVersion(h.version);
    if (!v) continue;
    if (v.major < REQ.playBillingMin) {
      out.push(finding({
        id: 'android.play-billing', platform: 'android', severity: 'blocker',
        title: `Play Billing Library ${h.version} is no longer accepted (need ${REQ.playBillingMin}.0+, ${REQ.playBillingNext}.0+ for new apps)`,
        detail: `Google Play has rejected new apps on Billing Library below 7 since Aug 31 2025 and updates since Nov 1 2025. Billing Library ${REQ.playBillingNext}.0+ is required for new apps since Aug 31 2026 and for all updates from Nov 1 2026.`,
        file: h.file, line: h.line,
        fix: `Upgrade to com.android.billingclient:billing:8.0.0 (or newer) in ${h.file}; migrate deprecated calls (querySkuDetails -> queryProductDetails, launchBillingFlow params) and, for Flutter/RN wrappers, update in_app_purchase / react-native-iap to a release that bundles PBL 8.`,
        docs: DOCS.billing,
      }));
    } else if (v.major < REQ.playBillingNext) {
      out.push(finding({
        id: 'android.play-billing', platform: 'android', severity: 'warning',
        title: `Play Billing Library ${h.version}; ${REQ.playBillingNext}.0+ is required for new apps since Aug 31 2026 and all updates from Nov 1 2026`,
        detail: 'Billing Library 7 was the 2025 minimum. Google deprecates one major per year; submissions on 7.x are refused for new apps now and for updates from Nov 1 2026.',
        file: h.file, line: h.line,
        fix: `Bump com.android.billingclient:billing to 8.0.0+ in ${h.file} and re-test purchase flows.`,
        docs: DOCS.billing,
      }));
    }
  }
}

export { manifestPermissions, resolveSdk, expoBuildProperties };
