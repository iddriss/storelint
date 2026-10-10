# StoreLint — lint your app before the store does

StoreLint scans a **Flutter**, **React Native** or **Expo** project folder and reports everything that would get it rejected or blocked on **Google Play** and the **App Store** in 2026: targetSdk 35/36, 16 KB page alignment, debug signing, exported components, Play Billing versions, privacy manifests, usage descriptions, push entitlements, Xcode 26, leaked keys, `.env` in git, placeholder config, missing icons and more.

It reads files only. No build, no Gradle, no Xcode, no network, zero runtime dependencies. The only subprocess is `git ls-files` (optional; falls back to `.gitignore` matching).

## Usage

```bash
npx github:iddriss/storelint
```

```
storelint [path] [--json] [--ci] [--platform android|ios] [--no-color]
```

| Flag | Effect |
| --- | --- |
| `path` | Project root (folder with `pubspec.yaml`, `app.json` or `package.json`). Default `.` |
| `--json` | Print the report as JSON (schema below) |
| `--ci` | Exit code 1 when any blocker is found |
| `--platform android\|ios` | Only report that platform (cross-platform findings are kept) |
| `--no-color` | Disable ANSI colours (`NO_COLOR` is also respected) |

Requires Node 18+. Works on Expo managed projects (reads `app.json` / `expo-build-properties`) as well as prebuilt ones.

## Sample output

```
StoreLint v0.1.0  flutter_app (flutter)  ./my-app

  BLOCKERS (20)
  ✖ android.target-sdk [android]
    targetSdk is 33; Google Play requires 35
    android/app/build.gradle:50
    fix: Set targetSdk to 36 in android/app/build.gradle (`targetSdk = 36` / `targetSdkVersion 36`), bump compileSdk to match, and re-test ...
    docs: https://developer.android.com/google/play/requirements/target-sdk

  ✖ android.page-size-16kb [android]
    Android Gradle Plugin 7.3.0 cannot produce 16 KB page-aligned native libraries (need 8.5.1+)
    android/build.gradle:9
    fix: Set the Android Gradle Plugin to 8.7.0 or newer (e.g. `id "com.android.application" version "8.9.1" apply false` in android/settings.gradle ...
    docs: https://developer.android.com/guide/practices/page-sizes

  ✖ ios.privacy-manifest [ios]
    No PrivacyInfo.xcprivacy in the iOS app target
    ios/Runner
    fix: Add ios/Runner/PrivacyInfo.xcprivacy (File > New > App Privacy in Xcode) to the app target with NSPrivacyTracking, ...
    docs: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files

  ✖ app.secrets [android+ios]
    Stripe live secret key committed in lib/config.dart (sk_live_…78)
    lib/config.dart:2
    fix: Remove the value from lib/config.dart, rotate it at the provider, and load it at build time instead ...

  WARNINGS (14)
  ▲ android.cleartext [android]
    usesCleartextTraffic="true" allows unencrypted HTTP
    android/app/src/main/AndroidManifest.xml:10
    fix: Remove android:usesCleartextTraffic from android/app/src/main/AndroidManifest.xml (or set it to false). ...

  INFO (6)
  ℹ ios.encryption-flag [ios]
    ITSAppUsesNonExemptEncryption is not set in Info.plist
    ios/Runner/Info.plist
    fix: Add <key>ITSAppUsesNonExemptEncryption</key><false/> to ios/Runner/Info.plist if you only use HTTPS/standard encryption ...

Score 0/100  ·  20 blockers  ·  14 warnings  ·  6 info
Want it fixed and shipped? https://storelint.iraaj.com/ship
```

**Score** = 100 − 25·blockers − 5·warnings, floored at 0.

## Checks

Severity is the default; some checks downgrade when the toolchain manages the value (e.g. EAS Build signing) or upgrade when a stricter 2026 deadline applies.

### Android (`android.*`)

| id | severity | what it catches |
| --- | --- | --- |
| `android.target-sdk` | blocker / warning | `targetSdk` < 35 (blocker), `targetSdk` 35 (warning: 36 required for new apps and updates from Aug 31 2026), `compileSdk` < 35 (warning). Resolves `flutter.targetSdkVersion`, `rootProject.ext`, `libs.versions.toml`, `gradle.properties`, Expo SDK defaults and `expo-build-properties`. |
| `android.page-size-16kb` | blocker | Android Gradle Plugin < 8.5.1 (incl. the AGP bundled by React Native < 0.76 / Expo SDK < 52), or NDK < r28 when the app compiles its own native code. Required for Android 15+ targets since Nov 1 2025. |
| `android.min-sdk` | warning | `minSdk` < 21 |
| `android.application-id` | blocker | `applicationId` / `expo.android.package` in `com.example.*` |
| `android.debug-signing` | blocker | release buildType uses `signingConfigs.debug` or has no `signingConfig` (warning on Expo projects with `eas.json`) |
| `android.keystore-in-repo` | blocker | `*.jks`, `*.keystore`, `key.properties` tracked by git (RN's public `debug.keystore` is ignored) |
| `android.cleartext` | warning | `android:usesCleartextTraffic="true"` (or via `expo-build-properties`) |
| `android.exported` | blocker | `<activity>`/`<service>`/`<receiver>` with an `<intent-filter>` but no `android:exported` (install fails on API 31+) |
| `android.play-core-legacy` | warning | `com.google.android.play:core` dependency (rejected for targetSdk 34+) |
| `android.ads-id` | warning | `AD_ID` permission without an ads SDK, or an ads SDK (AdMob, FAN, AppLovin, Unity…) without the permission |
| `android.permissions-dangerous` | info | lists runtime/sensitive permissions to declare in the Data Safety form |
| `android.version-code` | info | `versionCode` missing, Flutter `version:` without `+build`, Expo without `versionCode`/`autoIncrement` |
| `android.proguard` | warning | `minifyEnabled true` without `proguard-rules.pro` |
| `android.play-billing` | blocker / warning | Play Billing Library < 7 (blocker; required since Nov 1 2025), 7.x (warning; 8+ required for new apps since Aug 31 2026, all updates from Nov 1 2026) |

### iOS (`ios.*`)

| id | severity | what it catches |
| --- | --- | --- |
| `ios.deployment-target` | blocker / warning | `IPHONEOS_DEPLOYMENT_TARGET` < 12 (blocker), < 13 (warning); Podfile and Expo defaults as fallbacks |
| `ios.privacy-manifest` | blocker | no `PrivacyInfo.xcprivacy` in the app target (Expo SDK < 51 without `ios.privacyManifests`) |
| `ios.required-reason-apis` | warning | privacy manifest without `NSPrivacyAccessedAPITypes` (UserDefaults reason CA92.1 is needed by almost every app) |
| `ios.usage-descriptions` | blocker (info for `permission_handler`) | a dependency implies camera / photos / location / microphone / speech / contacts / Face ID / Bluetooth / tracking / health / calendar / motion but `Info.plist` (or `expo.ios.infoPlist`) lacks the `NS*UsageDescription`. Expo config plugins (`expo-*`) are trusted to add their own. |
| `ios.encryption-flag` | info | `ITSAppUsesNonExemptEncryption` missing (export-compliance prompt on every upload) |
| `ios.ats` | warning | `NSAllowsArbitraryLoads = true` |
| `ios.bundle-id` | blocker | `PRODUCT_BUNDLE_IDENTIFIER` / `expo.ios.bundleIdentifier` in `com.example.*` or `org.reactjs.native.example.*` |
| `ios.xcode-version` | warning | `LastUpgradeCheck` < 1600 (Xcode 26 / iOS 26 SDK required for submissions since Apr 28 2026) |
| `ios.push-entitlement` | blocker | Firebase Messaging / OneSignal / expo-notifications / APNs libraries present but no `aps-environment` entitlement |
| `ios.launch-screen` | warning | no `UILaunchStoryboardName` / `UILaunchScreen`, or the referenced storyboard is missing |

### Cross-platform (`app.*`)

| id | severity | what it catches |
| --- | --- | --- |
| `app.secrets` | blocker | Google API keys, Stripe `sk_live_`/`sk_test_`/`rk_live_`, AWS `AKIA…`, private key blocks, GitHub/Slack/OpenAI/Anthropic/Twilio/SendGrid tokens in tracked source (Firebase client config files are exempt) |
| `app.dotenv-tracked` | blocker | `.env`, `.env.production` … tracked by git (`.env.example` is fine) |
| `app.placeholder-config` | warning | `YOUR_API_KEY`, `TODO`, `CHANGEME`, `localhost`, `127.0.0.1`, `10.0.2.2` … in release config (gradle, manifest, Info.plist, app.json, strings.xml, `lib/**/config*.dart`, `src/**/config*.ts`) |
| `app.icons` | warning | no adaptive icon (`mipmap-anydpi-v26/ic_launcher.xml` or `expo.android.adaptiveIcon`), no 1024×1024 iOS marketing icon (checks the PNG dimensions) |
| `app.name` | info | display name is a template default (`flutter_app`, `MyApp`, `app`, snake_case project name…) |
| `app.version-mismatch` | info | pubspec / package.json version differs from hard-coded `versionName` / `MARKETING_VERSION` |
| `app.flutter-version` | warning | Flutter < 3.19 (from `.fvmrc`, `.flutter-version`, `.tool-versions`, or SDK constraints in `pubspec.lock`) |
| `app.rn-version` | warning | React Native < 0.73 |
| `app.expo` | blocker / warning | `expo.ios.bundleIdentifier` or `expo.android.package` missing (info when `app.config.js` is dynamic), Expo SDK < 51 |
| `app.unknown-framework` | info | no Flutter / RN / Expo project detected; only cross checks ran |

## JSON mode

`storelint --json` prints the report that the web scanner and the MCP tool also use (`schemaVersion` 1):

```json
{
  "schemaVersion": 1,
  "scannedAt": "2026-10-10T12:00:00.000Z",
  "project": { "path": ".", "framework": "flutter", "name": "my_app" },
  "summary": { "blocker": 1, "warning": 0, "info": 0, "score": 75 },
  "findings": [
    {
      "id": "android.target-sdk",
      "platform": "android",
      "severity": "blocker",
      "title": "targetSdk is 33; Google Play requires 35",
      "detail": "Google Play has rejected new apps and updates targeting below API 35 since Aug 31 2025.",
      "file": "android/app/build.gradle",
      "line": 50,
      "fix": "Set targetSdk to 36 in android/app/build.gradle ...",
      "docs": "https://developer.android.com/google/play/requirements/target-sdk"
    }
  ]
}
```

`platform` is `android`, `ios` or `both`; `severity` is `blocker`, `warning` or `info`; `file`, `line` and `docs` are optional.

From Node:

```js
import { scan } from 'storelint';
const report = await scan('./my-app', { platform: 'ios' }); // options are optional
```

## CI

Fail the pipeline when a blocker is present:

```yaml
# .github/workflows/storelint.yml
name: StoreLint
on: [push, pull_request]
jobs:
  storelint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx github:iddriss/storelint . --ci
      - if: always()
        run: npx github:iddriss/storelint . --json > storelint-report.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: storelint-report
          path: storelint-report.json
```

Exit codes: `0` ok, `1` blockers found (only with `--ci`), `2` usage or scan error.

## Claude Code plugin

The repository doubles as a Claude Code plugin (`.claude-plugin/plugin.json` + `skills/storelint/SKILL.md`). Once installed, ask Claude "is this app ready for the stores?" and it will run `npx github:iddriss/storelint --json`, explain each finding and offer to apply the fixes.

## Need it shipped for you?

StoreLint tells you what is wrong. If you would rather have someone fix the findings, set up signing, fill in Data Safety / privacy labels and walk the app through review, that is a fixed-price service:

**https://storelint.iraaj.com/ship**

## Development

```bash
pnpm install
pnpm test        # builds dist/ with tsc and runs node --test against test/fixtures/*
```

`dist/` is committed on purpose so `npx github:iddriss/storelint` works without a build step. Rebuild and commit it with every source change.

## License

MIT
