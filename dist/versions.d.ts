/**
 * Known-version tables. These encode what each toolchain release defaults to so
 * `flutter.targetSdkVersion`-style indirection can be resolved without running anything.
 */
import { type Version } from './util/version.js';
/** Store requirements used by the checks (numbers from the spec). */
export declare const REQ: {
    readonly androidTargetSdk: 35;
    readonly androidTargetSdkNext: 36;
    readonly androidCompileSdk: 35;
    readonly androidMinSdk: 21;
    readonly agpFor16Kb: "8.5.1";
    readonly ndkFor16Kb: 28;
    readonly playBillingMin: 7;
    readonly playBillingNext: 8;
    readonly iosDeploymentWarn: 13;
    readonly iosDeploymentBlock: 12;
    readonly xcodeMinLastUpgrade: 1600;
    readonly flutterMin: "3.19";
    readonly rnMin: "0.73";
    readonly expoMin: 51;
};
/** Default Android SDK levels baked into Flutter's gradle plugin, by Flutter minor version. */
export declare function flutterAndroidDefaults(v: Version): {
    compileSdk: number;
    targetSdk: number;
    minSdk: number;
};
/** Map a Dart SDK version to the Flutter release that ships it. */
export declare function flutterFromDart(d: Version): Version | null;
/** Android Gradle Plugin bundled by @react-native/gradle-plugin for a given RN minor. */
export declare function agpForReactNative(rn: Version): string | null;
/** React Native version bundled with an Expo SDK major. */
export declare function reactNativeForExpo(sdk: number): string | null;
/** Default Android target/compile/min SDK produced by `expo prebuild` for an Expo SDK major. */
export declare function expoAndroidDefaults(sdk: number): {
    compileSdk: number;
    targetSdk: number;
    minSdk: number;
};
export declare function expoIosDeploymentTarget(sdk: number): string;
