/** Run each check in isolation so one parser failure never kills the scan. */
export function runAll(checks) {
    const out = [];
    for (const c of checks) {
        try {
            c(out);
        }
        catch (err) {
            if (process.env.STORELINT_DEBUG)
                console.error(`[storelint] check failed: ${err.stack ?? err}`);
        }
    }
    return out;
}
export function finding(f) {
    const clean = { id: f.id, platform: f.platform, severity: f.severity, title: f.title, detail: f.detail, fix: f.fix };
    if (f.file)
        clean.file = f.file;
    if (typeof f.line === 'number' && f.line > 0)
        clean.line = f.line;
    if (f.docs)
        clean.docs = f.docs;
    return clean;
}
export const DOCS = {
    targetSdk: 'https://developer.android.com/google/play/requirements/target-sdk',
    pageSize: 'https://developer.android.com/guide/practices/page-sizes',
    signing: 'https://developer.android.com/studio/publish/app-signing',
    cleartext: 'https://developer.android.com/privacy-and-security/risks/cleartext-communications',
    exported: 'https://developer.android.com/about/versions/12/behavior-changes-12#exported',
    playCore: 'https://developer.android.com/guide/playcore#playcore-migration',
    adId: 'https://support.google.com/googleplay/android-developer/answer/6048248',
    dataSafety: 'https://support.google.com/googleplay/android-developer/answer/10787469',
    versionCode: 'https://developer.android.com/studio/publish/versioning',
    proguard: 'https://developer.android.com/build/shrink-code',
    billing: 'https://developer.android.com/google/play/billing/deprecation-faq',
    iosDeployment: 'https://developer.apple.com/support/app-store/',
    privacyManifest: 'https://developer.apple.com/documentation/bundleresources/privacy-manifest-files',
    requiredReason: 'https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api',
    usageDescriptions: 'https://developer.apple.com/documentation/bundleresources/information-property-list/protected-resources',
    encryption: 'https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations',
    ats: 'https://developer.apple.com/documentation/security/preventing-insecure-network-connections',
    xcode: 'https://developer.apple.com/news/upcoming-requirements/',
    push: 'https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment',
    launchScreen: 'https://developer.apple.com/documentation/uikit/specifying-your-apps-launch-screen',
    bundleId: 'https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution',
    expoConfig: 'https://docs.expo.dev/versions/latest/config/app/',
    expoUpgrade: 'https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/',
    secrets: 'https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning',
    androidIcons: 'https://developer.android.com/develop/ui/views/launch/icon_design_adaptive',
    iosIcons: 'https://developer.apple.com/design/human-interface-guidelines/app-icons',
    flutterRelease: 'https://docs.flutter.dev/deployment/android',
    rnRelease: 'https://reactnative.dev/docs/signed-apk-android',
    flutterVersions: 'https://docs.flutter.dev/release/archive',
    rnVersions: 'https://reactnative.dev/versions',
};
