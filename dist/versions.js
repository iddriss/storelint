/**
 * Known-version tables. These encode what each toolchain release defaults to so
 * `flutter.targetSdkVersion`-style indirection can be resolved without running anything.
 */
import { parseVersion } from './util/version.js';
/** Store requirements used by the checks (numbers from the spec). */
export const REQ = {
    androidTargetSdk: 35,
    androidTargetSdkNext: 36, // required for new apps + updates from Aug 31 2026 (ext. Nov 1 2026)
    androidCompileSdk: 35,
    androidMinSdk: 21,
    agpFor16Kb: '8.5.1',
    ndkFor16Kb: 28,
    playBillingMin: 7, // 7+ for all updates since Nov 1 2025
    playBillingNext: 8, // 8+ new apps since Aug 31 2026, all updates from Nov 1 2026
    iosDeploymentWarn: 13,
    iosDeploymentBlock: 12,
    xcodeMinLastUpgrade: 1600,
    flutterMin: '3.19',
    rnMin: '0.73',
    expoMin: 51,
};
/** Default Android SDK levels baked into Flutter's gradle plugin, by Flutter minor version. */
export function flutterAndroidDefaults(v) {
    const minor = v.major > 3 ? 999 : v.major < 3 ? -1 : v.minor;
    if (minor >= 35)
        return { compileSdk: 36, targetSdk: 36, minSdk: 24 };
    if (minor >= 27)
        return { compileSdk: 35, targetSdk: 35, minSdk: 21 };
    if (minor >= 22)
        return { compileSdk: 34, targetSdk: 34, minSdk: 21 };
    if (minor >= 16)
        return { compileSdk: 34, targetSdk: 34, minSdk: 19 };
    if (minor >= 7)
        return { compileSdk: 33, targetSdk: 33, minSdk: 16 };
    return { compileSdk: 32, targetSdk: 32, minSdk: 16 };
}
/** Map a Dart SDK version to the Flutter release that ships it. */
export function flutterFromDart(d) {
    if (d.major === 2) {
        if (d.minor >= 19)
            return parseVersion('3.7.0');
        if (d.minor >= 18)
            return parseVersion('3.3.0');
        if (d.minor >= 17)
            return parseVersion('3.0.0');
        return parseVersion('2.10.0');
    }
    if (d.major !== 3)
        return null;
    const table = {
        0: '3.10', 1: '3.13', 2: '3.16', 3: '3.19', 4: '3.22', 5: '3.24',
        6: '3.27', 7: '3.29', 8: '3.32', 9: '3.35', 10: '3.38',
    };
    if (d.minor in table)
        return parseVersion(table[d.minor]);
    // Extrapolate: roughly +3 Flutter minors per Dart minor after 3.10
    return parseVersion(`3.${38 + (d.minor - 10) * 3}`);
}
/** Android Gradle Plugin bundled by @react-native/gradle-plugin for a given RN minor. */
export function agpForReactNative(rn) {
    if (rn.major !== 0)
        return null;
    const table = {
        70: '7.3.1', 71: '7.3.1', 72: '7.4.2', 73: '8.1.1', 74: '8.2.1', 75: '8.5.0',
        76: '8.6.0', 77: '8.7.2', 78: '8.8.0', 79: '8.8.2', 80: '8.9.1', 81: '8.11.0', 82: '8.12.0',
    };
    if (rn.minor in table)
        return table[rn.minor];
    if (rn.minor > 82)
        return '8.12.0';
    return '7.0.0';
}
/** React Native version bundled with an Expo SDK major. */
export function reactNativeForExpo(sdk) {
    const table = {
        47: '0.70', 48: '0.71', 49: '0.72', 50: '0.73', 51: '0.74', 52: '0.76', 53: '0.79', 54: '0.81', 55: '0.83',
    };
    if (sdk in table)
        return table[sdk];
    if (sdk > 55)
        return '0.83';
    return '0.69';
}
/** Default Android target/compile/min SDK produced by `expo prebuild` for an Expo SDK major. */
export function expoAndroidDefaults(sdk) {
    if (sdk >= 54)
        return { compileSdk: 36, targetSdk: 36, minSdk: 24 };
    if (sdk >= 52)
        return { compileSdk: 35, targetSdk: 35, minSdk: 24 };
    if (sdk >= 50)
        return { compileSdk: 34, targetSdk: 34, minSdk: 23 };
    return { compileSdk: 33, targetSdk: 33, minSdk: 21 };
}
export function expoIosDeploymentTarget(sdk) {
    if (sdk >= 52)
        return '15.1';
    if (sdk >= 50)
        return '13.4';
    return '13.0';
}
