import { DOCS, finding, runAll } from './common.js';
import { parsePlist, pGet } from '../util/plist.js';
import { findLine } from '../util/text.js';
import { versionLt } from '../util/version.js';
import { REQ, expoIosDeploymentTarget } from '../versions.js';
import { expoBuildProperties } from './android.js';
const USAGE_RULES = [
    { deps: ['image_picker', 'image_picker_ios', 'react-native-image-picker', 'react-native-image-crop-picker', 'expo-image-picker', 'file_picker'], keys: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'], why: 'takes photos and picks from the photo library' },
    { deps: ['camera', 'camera_avfoundation', 'expo-camera', 'react-native-vision-camera', 'react-native-camera', 'camerawesome'], keys: ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'], why: 'shows a camera preview and records video with audio' },
    { deps: ['mobile_scanner', 'qr_code_scanner', 'flutter_barcode_scanner', 'barcode_scan2', 'expo-barcode-scanner', 'react-native-qrcode-scanner', 'ai_barcode_scanner'], keys: ['NSCameraUsageDescription'], why: 'scans barcodes with the camera' },
    { deps: ['geolocator', 'geolocator_apple', 'location', 'expo-location', '@react-native-community/geolocation', 'react-native-geolocation-service', 'react-native-location', 'flutter_background_geolocation', 'background_location', 'geolocation'], keys: ['NSLocationWhenInUseUsageDescription'], why: 'reads the device location' },
    { deps: ['speech_to_text', '@react-native-voice/voice', 'react-native-voice'], keys: ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'], why: 'performs speech recognition' },
    { deps: ['record', 'flutter_sound', 'mic_stream', 'audio_waveforms', 'flutter_audio_capture', 'audio_streamer', 'react-native-audio-recorder-player', 'react-native-audio-record', 'expo-av', 'expo-audio', 'react-native-sound-recorder', 'agora_rtc_engine', 'flutter_webrtc', 'react-native-webrtc', 'react-native-agora', 'livekit_client', '@livekit/react-native'], keys: ['NSMicrophoneUsageDescription'], why: 'records audio' },
    { deps: ['flutter_contacts', 'contacts_service', 'fast_contacts', 'react-native-contacts', 'expo-contacts'], keys: ['NSContactsUsageDescription'], why: 'reads contacts' },
    { deps: ['local_auth', 'local_auth_darwin', 'local_auth_ios', 'react-native-biometrics', 'expo-local-authentication', 'react-native-touch-id', 'react-native-fingerprint-scanner', 'flutter_local_authentication'], keys: ['NSFaceIDUsageDescription'], why: 'authenticates with Face ID' },
    { deps: ['flutter_blue', 'flutter_blue_plus', 'flutter_reactive_ble', 'flutter_bluetooth_serial', 'react-native-ble-plx', 'react-native-ble-manager', 'quick_blue', 'universal_ble', 'flutter_bluetooth_classic'], keys: ['NSBluetoothAlwaysUsageDescription'], why: 'uses Bluetooth' },
    { deps: ['photo_manager', 'image_gallery_saver', 'image_gallery_saver_plus', 'gal', 'gallery_saver', 'expo-media-library', '@react-native-camera-roll/camera-roll', 'react-native-cameraroll'], keys: ['NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription'], why: 'reads from and saves to the photo library' },
    { deps: ['app_tracking_transparency', 'expo-tracking-transparency', 'react-native-tracking-transparency'], keys: ['NSUserTrackingUsageDescription'], why: 'requests App Tracking Transparency' },
    { deps: ['health', 'react-native-health', 'health_kit_reporter'], keys: ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription'], why: 'reads/writes HealthKit data' },
    { deps: ['device_calendar', 'expo-calendar', 'react-native-calendar-events', 'add_2_calendar'], keys: ['NSCalendarsUsageDescription|NSCalendarsFullAccessUsageDescription|NSCalendarsWriteOnlyAccessUsageDescription'], why: 'accesses the calendar' },
    { deps: ['pedometer', 'react-native-pedometer', 'expo-sensors', 'flutter_pedometer'], keys: ['NSMotionUsageDescription'], why: 'reads motion/fitness data' },
];
const PUSH_DEPS = [
    'firebase_messaging', '@react-native-firebase/messaging', 'expo-notifications', 'onesignal_flutter', 'react-native-onesignal',
    'react-native-push-notification', '@react-native-community/push-notification-ios', 'react-native-notifications', 'pusher_beams',
    'flutter_apns', 'flutter_apns_only', 'airship_flutter', 'react-native-airship', 'huawei_push', 'pushy_flutter', 'pushy-react-native',
    'clevertap_plugin', 'customer_io', 'moengage_flutter', 'braze_plugin', '@braze/react-native-sdk', 'react-native-customerio',
];
function loadInfoPlist(p) {
    const file = p.infoPlist;
    if (!file)
        return null;
    const parsed = parsePlist(p.read(file) ?? '');
    return { file, root: parsed.root, keyLines: parsed.keyLines };
}
function expoIos(p) {
    const ios = p.expo?.data.ios;
    return ios && typeof ios === 'object' ? ios : {};
}
function expoPlugins(p) {
    const plugins = p.expo?.data.plugins;
    if (!Array.isArray(plugins))
        return [];
    return plugins.map((pl) => (Array.isArray(pl) ? String(pl[0]) : String(pl)));
}
export function iosChecks(p) {
    const checks = [
        (o) => checkDeploymentTarget(p, o),
        (o) => checkPrivacyManifest(p, o),
        (o) => checkRequiredReasonApis(p, o),
        (o) => checkUsageDescriptions(p, o),
        (o) => checkEncryptionFlag(p, o),
        (o) => checkAts(p, o),
        (o) => checkBundleId(p, o),
        (o) => checkXcodeVersion(p, o),
        (o) => checkPushEntitlement(p, o),
        (o) => checkLaunchScreen(p, o),
    ];
    return runAll(checks);
}
function checkDeploymentTarget(p, out) {
    let target = null;
    let file;
    let line;
    const proj = p.pbxproj;
    if (proj) {
        const text = p.read(proj);
        const re = /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([\d.]+)"?\s*;/g;
        let m;
        let min = null;
        while ((m = re.exec(text))) {
            if (!min || versionLt(m[1], min.v))
                min = { v: m[1], idx: m.index };
        }
        if (min) {
            target = min.v;
            file = proj;
            line = findLine(text, new RegExp(`IPHONEOS_DEPLOYMENT_TARGET\\s*=\\s*"?${min.v.replace('.', '\\.')}"?\\s*;`))?.line;
        }
    }
    if (!target && p.exists('ios/Podfile')) {
        const text = p.read('ios/Podfile');
        const m = findLine(text, /^\s*platform\s*:ios\s*,\s*['"]([\d.]+)['"]/m);
        if (m) {
            target = m.match[1];
            file = 'ios/Podfile';
            line = m.line;
        }
    }
    if (!target && p.expoManaged) {
        const bp = expoBuildProperties(p);
        const override = bp?.ios?.deploymentTarget;
        const sdk = p.expoSdk();
        if (typeof override === 'string') {
            target = override;
            file = p.expo.file;
        }
        else if (sdk !== null) {
            target = expoIosDeploymentTarget(sdk);
            file = p.expo.file;
        }
    }
    if (!target)
        return;
    if (versionLt(target, String(REQ.iosDeploymentBlock))) {
        out.push(finding({
            id: 'ios.deployment-target', platform: 'ios', severity: 'blocker',
            title: `IPHONEOS_DEPLOYMENT_TARGET is ${target}; current SDKs cannot build below iOS ${REQ.iosDeploymentBlock}`,
            detail: `Xcode 26 (required for App Store submissions since Apr 28 2026) and current Flutter/React Native releases do not support iOS below ${REQ.iosDeploymentBlock}; the archive will fail or be rejected.`,
            file, line,
            fix: `Set IPHONEOS_DEPLOYMENT_TARGET to 13.0 or higher in ${file ?? 'the Xcode project'} for every configuration, and \`platform :ios, '13.0'\` in ios/Podfile; then run pod install.`,
            docs: DOCS.iosDeployment,
        }));
    }
    else if (versionLt(target, String(REQ.iosDeploymentWarn))) {
        out.push(finding({
            id: 'ios.deployment-target', platform: 'ios', severity: 'warning',
            title: `IPHONEOS_DEPLOYMENT_TARGET is ${target}; raise it to ${REQ.iosDeploymentWarn}.0 or higher`,
            detail: 'Flutter 3.32+ and React Native 0.76+ require iOS 13+ (RN 0.81 requires 15.1). Pods built for iOS 12 trigger deprecation warnings and some SDKs refuse to link.',
            file, line,
            fix: `Set IPHONEOS_DEPLOYMENT_TARGET = 13.0 (or 15.1 for RN 0.81+) in ${file ?? 'ios/Runner.xcodeproj/project.pbxproj'} for all configurations and in ios/Podfile (\`platform :ios, '13.0'\`).`,
            docs: DOCS.iosDeployment,
        }));
    }
}
function privacyManifests(p) {
    return p.find((f) => f.startsWith('ios/') && f.endsWith('PrivacyInfo.xcprivacy') && !f.startsWith('ios/Pods/'));
}
function checkPrivacyManifest(p, out) {
    if (p.hasIos) {
        if (privacyManifests(p).length > 0)
            return;
        const dir = p.infoPlist ? p.infoPlist.replace(/\/Info\.plist$/, '') : 'ios/Runner';
        out.push(finding({
            id: 'ios.privacy-manifest', platform: 'ios', severity: 'blocker',
            title: 'No PrivacyInfo.xcprivacy in the iOS app target',
            detail: 'App Store Connect has required a privacy manifest since May 1 2024. Uploads without one (or that use required-reason APIs such as UserDefaults without declaring a reason) are rejected with ITMS-91053.',
            file: dir,
            fix: `Add ${dir}/PrivacyInfo.xcprivacy (File > New > App Privacy in Xcode) to the app target with NSPrivacyTracking, NSPrivacyCollectedDataTypes and NSPrivacyAccessedAPITypes (at least CA92.1 for NSUserDefaults). Flutter: \`flutter create .\` on 3.19+ generates one.`,
            docs: DOCS.privacyManifest,
        }));
        return;
    }
    if (p.expoManaged) {
        const sdk = p.expoSdk();
        if (expoIos(p).privacyManifests)
            return;
        if (sdk !== null && sdk < 51) {
            out.push(finding({
                id: 'ios.privacy-manifest', platform: 'ios', severity: 'blocker',
                title: `Expo SDK ${sdk} does not generate a PrivacyInfo.xcprivacy`,
                detail: 'App Store Connect requires a privacy manifest since May 1 2024. Expo adds a default one only from SDK 51.',
                file: p.expo.file,
                fix: `Upgrade to Expo SDK 51+ (\`npx expo install expo@latest\` then \`npx expo install --fix\`), or add \`ios.privacyManifests\` with NSPrivacyAccessedAPITypes to ${p.expo.file}.`,
                docs: DOCS.privacyManifest,
            }));
        }
    }
}
function checkRequiredReasonApis(p, out) {
    if (p.hasIos) {
        const files = privacyManifests(p);
        if (files.length === 0)
            return;
        const ok = files.some((f) => {
            const parsed = parsePlist(p.read(f) ?? '');
            const types = pGet(parsed.root, 'NSPrivacyAccessedAPITypes');
            return Array.isArray(types) && types.length > 0;
        });
        if (ok)
            return;
        out.push(finding({
            id: 'ios.required-reason-apis', platform: 'ios', severity: 'warning',
            title: 'PrivacyInfo.xcprivacy declares no NSPrivacyAccessedAPITypes',
            detail: 'Almost every app reads NSUserDefaults (shared_preferences, AsyncStorage, Firebase). Using a required-reason API without a declared reason triggers ITMS-91053 and the build is rejected after upload.',
            file: files[0],
            fix: `Add an NSPrivacyAccessedAPITypes array to ${files[0]} with NSPrivacyAccessedAPICategoryUserDefaults (reason CA92.1); add file-timestamp (C617.1), system-boot-time (35F9.1) and disk-space (E174.1) entries if your dependencies use them.`,
            docs: DOCS.requiredReason,
        }));
        return;
    }
    if (p.expoManaged) {
        const pm = expoIos(p).privacyManifests;
        if (pm && typeof pm === 'object' && !(Array.isArray(pm.NSPrivacyAccessedAPITypes) && pm.NSPrivacyAccessedAPITypes.length > 0)) {
            out.push(finding({
                id: 'ios.required-reason-apis', platform: 'ios', severity: 'warning',
                title: 'ios.privacyManifests has no NSPrivacyAccessedAPITypes',
                detail: 'Apps that touch NSUserDefaults (AsyncStorage, expo-secure-store, Firebase) must declare a reason or App Store Connect rejects the upload with ITMS-91053.',
                file: p.expo.file,
                fix: `Add NSPrivacyAccessedAPITypes with NSPrivacyAccessedAPICategoryUserDefaults / CA92.1 to ios.privacyManifests in ${p.expo.file}.`,
                docs: DOCS.requiredReason,
            }));
        }
    }
}
function checkUsageDescriptions(p, out) {
    const deps = p.deps();
    const managed = p.expoManaged;
    let has;
    let file;
    if (p.hasIos) {
        const plist = loadInfoPlist(p);
        if (!plist)
            return;
        file = plist.file;
        has = (k) => {
            const v = pGet(plist.root, k);
            return typeof v === 'string' && v.trim().length > 0;
        };
    }
    else if (managed) {
        const infoPlist = expoIos(p).infoPlist ?? {};
        file = p.expo.file;
        has = (k) => typeof infoPlist[k] === 'string' && infoPlist[k].trim().length > 0;
    }
    else {
        return;
    }
    const missing = new Map();
    for (const rule of USAGE_RULES) {
        const dep = rule.deps.find((d) => deps.has(d) && !(managed && d.startsWith('expo-')));
        if (!dep)
            continue;
        for (const keySpec of rule.keys) {
            const alts = keySpec.split('|');
            if (alts.some(has))
                continue;
            if (!missing.has(alts[0]))
                missing.set(alts[0], { dep, why: rule.why });
        }
    }
    for (const [key, { dep, why }] of missing) {
        const where = managed ? `expo.ios.infoPlist in ${file}` : file;
        out.push(finding({
            id: 'ios.usage-descriptions', platform: 'ios', severity: 'blocker',
            title: `${key} missing but ${dep} ${why}`,
            detail: `iOS kills the app the moment the API is touched without a purpose string, and App Review rejects binaries whose Info.plist lacks ${key} for a framework they link (Guideline 5.1.1).`,
            file,
            fix: `Add <key>${key}</key><string>Explain, in user terms, why ${p.name} needs this</string> to ${where}. The string must describe actual use; generic text ("needed for the app") is rejected.`,
            docs: DOCS.usageDescriptions,
        }));
    }
    if (deps.has('permission_handler') && (p.hasIos || managed)) {
        out.push(finding({
            id: 'ios.usage-descriptions', platform: 'ios', severity: 'info',
            title: 'permission_handler is present: check Podfile macros and purpose strings',
            detail: 'permission_handler compiles every permission by default. App Review rejects apps whose Info.plist mentions permissions they never use, and crashes apps that request a permission without the matching NS*UsageDescription.',
            file: p.exists('ios/Podfile') ? 'ios/Podfile' : file,
            fix: 'In ios/Podfile set PERMISSION_* macros to 1 only for the permissions you request (e.g. PERMISSION_CAMERA=1) and 0 for the rest, and add the matching NS*UsageDescription keys to Info.plist.',
            docs: DOCS.usageDescriptions,
        }));
    }
}
function checkEncryptionFlag(p, out) {
    if (p.hasIos) {
        const plist = loadInfoPlist(p);
        if (!plist)
            return;
        if (pGet(plist.root, 'ITSAppUsesNonExemptEncryption') !== undefined)
            return;
        out.push(finding({
            id: 'ios.encryption-flag', platform: 'ios', severity: 'info',
            title: 'ITSAppUsesNonExemptEncryption is not set in Info.plist',
            detail: 'Without it App Store Connect asks the export-compliance question after every upload and holds the build until it is answered.',
            file: plist.file,
            fix: `Add <key>ITSAppUsesNonExemptEncryption</key><false/> to ${plist.file} if you only use HTTPS/standard encryption; otherwise set it to true and provide compliance documentation.`,
            docs: DOCS.encryption,
        }));
        return;
    }
    if (p.expoManaged) {
        const ios = expoIos(p);
        if (ios.config?.usesNonExemptEncryption !== undefined)
            return;
        if (ios.infoPlist?.ITSAppUsesNonExemptEncryption !== undefined)
            return;
        out.push(finding({
            id: 'ios.encryption-flag', platform: 'ios', severity: 'info',
            title: 'ios.config.usesNonExemptEncryption is not set',
            detail: 'App Store Connect will ask the export-compliance question on every build until the key is in Info.plist.',
            file: p.expo.file,
            fix: `Add \`"ios": { "config": { "usesNonExemptEncryption": false } }\` to ${p.expo.file} (true if you ship custom cryptography).`,
            docs: DOCS.encryption,
        }));
    }
}
function checkAts(p, out) {
    if (p.hasIos) {
        const plist = loadInfoPlist(p);
        if (!plist)
            return;
        if (pGet(plist.root, 'NSAppTransportSecurity', 'NSAllowsArbitraryLoads') !== true)
            return;
        out.push(finding({
            id: 'ios.ats', platform: 'ios', severity: 'warning',
            title: 'NSAllowsArbitraryLoads is true (App Transport Security disabled)',
            detail: 'App Review asks for justification when ATS is disabled app-wide and rejects apps that cannot explain it (Guideline 2.5.1 / 5.1.1). It also contradicts "encrypted in transit" on the privacy label.',
            file: plist.file, line: plist.keyLines.get('NSAppTransportSecurity'),
            fix: `Remove NSAllowsArbitraryLoads from ${plist.file}. If one host needs HTTP, add it under NSExceptionDomains with NSExceptionAllowsInsecureHTTPLoads, or use NSAllowsArbitraryLoadsInWebContent for web views only.`,
            docs: DOCS.ats,
        }));
        return;
    }
    if (p.expoManaged) {
        const ip = expoIos(p).infoPlist;
        if (ip?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) {
            out.push(finding({
                id: 'ios.ats', platform: 'ios', severity: 'warning',
                title: 'NSAllowsArbitraryLoads is true in ios.infoPlist',
                detail: 'App Transport Security is disabled app-wide; App Review requires a justification and may reject.',
                file: p.expo.file,
                fix: `Remove NSAppTransportSecurity.NSAllowsArbitraryLoads from ios.infoPlist in ${p.expo.file} or scope it to NSExceptionDomains.`,
                docs: DOCS.ats,
            }));
        }
    }
}
function checkBundleId(p, out) {
    const proj = p.pbxproj;
    if (proj) {
        const text = p.read(proj);
        const re = /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?\s*;/g;
        const seen = new Set();
        let m;
        while ((m = re.exec(text))) {
            const id = m[1].trim();
            if (seen.has(id) || /Tests$/.test(id))
                continue;
            if (!/^(com\.example(\.|$)|org\.reactjs\.native\.example(\.|$))/.test(id))
                continue;
            seen.add(id);
            out.push(finding({
                id: 'ios.bundle-id', platform: 'ios', severity: 'blocker',
                title: `PRODUCT_BUNDLE_IDENTIFIER "${id}" is a template placeholder`,
                detail: 'App Store Connect will not register com.example.* or org.reactjs.native.example.* identifiers, and the bundle id must match an App ID in your developer account.',
                file: proj, line: findLine(text, new RegExp(`PRODUCT_BUNDLE_IDENTIFIER\\s*=\\s*"?${id.replace(/[.$()]/g, '\\$&')}"?\\s*;`))?.line,
                fix: `Set PRODUCT_BUNDLE_IDENTIFIER to a reverse-DNS id you own (e.g. com.yourcompany.appname) for every configuration in ${proj} (Xcode > Runner target > Signing & Capabilities), register it in the Apple Developer portal, and keep the test target as <id>.RunnerTests.`,
                docs: DOCS.bundleId,
            }));
        }
        return;
    }
    if (p.expoManaged) {
        const id = expoIos(p).bundleIdentifier;
        if (typeof id === 'string' && /^(com\.example(\.|$)|org\.reactjs\.native\.example(\.|$))/.test(id)) {
            out.push(finding({
                id: 'ios.bundle-id', platform: 'ios', severity: 'blocker',
                title: `ios.bundleIdentifier "${id}" is a template placeholder`,
                detail: 'App Store Connect will not register com.example.* identifiers.',
                file: p.expo.file,
                fix: `Set expo.ios.bundleIdentifier in ${p.expo.file} to a reverse-DNS id you own.`,
                docs: DOCS.expoConfig,
            }));
        }
    }
}
function checkXcodeVersion(p, out) {
    const proj = p.pbxproj;
    if (!proj)
        return;
    const text = p.read(proj);
    const luc = findLine(text, /LastUpgradeCheck\s*=\s*(\d+)\s*;/);
    const ov = findLine(text, /objectVersion\s*=\s*(\d+)\s*;/);
    let implied = null;
    let line;
    if (luc) {
        const n = Number(luc.match[1]);
        if (n < REQ.xcodeMinLastUpgrade) {
            implied = `LastUpgradeCheck = ${n} (Xcode ${Math.floor(n / 100)}.${Math.floor((n % 100) / 10)})`;
            line = luc.line;
        }
    }
    else if (ov && Number(ov.match[1]) < 50) {
        implied = `objectVersion = ${ov.match[1]} (Xcode 9 era)`;
        line = ov.line;
    }
    if (!implied)
        return;
    out.push(finding({
        id: 'ios.xcode-version', platform: 'ios', severity: 'warning',
        title: `Xcode project last upgraded with Xcode < 16 (${implied})`,
        detail: 'Since Apr 28 2026 App Store Connect only accepts builds made with Xcode 26 and the iOS 26 SDK. A project still on Xcode 15-era settings usually carries deprecated build settings and an old deployment target that break under Xcode 26.',
        file: proj, line,
        fix: `Open ${proj.replace('/project.pbxproj', '')} in Xcode 26, accept "Update to recommended settings" (this bumps LastUpgradeCheck), archive with the iOS 26 SDK, and run the full test suite. CI: use the xcode-26 image / \`sudo xcode-select -s /Applications/Xcode_26.app\`.`,
        docs: DOCS.xcode,
    }));
}
function checkPushEntitlement(p, out) {
    const deps = p.deps();
    const dep = PUSH_DEPS.find((d) => deps.has(d));
    if (!dep)
        return;
    if (p.hasIos) {
        const files = p.entitlementsFiles();
        const ok = files.some((f) => pGet(parsePlist(p.read(f) ?? '').root, 'aps-environment') !== undefined);
        if (ok)
            return;
        const dir = p.infoPlist ? p.infoPlist.replace(/\/Info\.plist$/, '') : 'ios/Runner';
        out.push(finding({
            id: 'ios.push-entitlement', platform: 'ios', severity: 'blocker',
            title: `${dep} is used but no entitlements file declares aps-environment`,
            detail: `${files.length === 0 ? 'No .entitlements file exists in the iOS target.' : `Found ${files.join(', ')} without aps-environment.`} Without the Push Notifications capability the device never gets an APNs token, and App Store Connect flags "Missing Push Notification Entitlement" (ITMS-90078).`,
            file: files[0] ?? dir,
            fix: `In Xcode select the app target > Signing & Capabilities > + Capability > Push Notifications (creates ${dir}/${p.name === 'Runner' ? 'Runner' : dir.split('/').pop()}.entitlements with aps-environment), enable Background Modes > Remote notifications if needed, and make sure the App ID in the developer portal has Push enabled.`,
            docs: DOCS.push,
        }));
        return;
    }
    if (p.expoManaged) {
        if (dep === 'expo-notifications')
            return; // config plugin adds the entitlement
        const plugins = expoPlugins(p);
        if (plugins.includes('onesignal-expo-plugin'))
            return;
        const ent = expoIos(p).entitlements;
        if (ent && ent['aps-environment'])
            return;
        out.push(finding({
            id: 'ios.push-entitlement', platform: 'ios', severity: 'blocker',
            title: `${dep} is used but app config has no aps-environment entitlement`,
            detail: 'EAS Build only enables the Push Notifications capability when the entitlement is in the config; otherwise APNs registration fails and App Store Connect flags ITMS-90078.',
            file: p.expo.file,
            fix: dep.includes('onesignal')
                ? `Add "onesignal-expo-plugin" to expo.plugins in ${p.expo.file} (it injects aps-environment and the notification service extension).`
                : `Add \`"ios": { "entitlements": { "aps-environment": "production" } }\` to ${p.expo.file} (or list the library's config plugin under expo.plugins).`,
            docs: DOCS.push,
        }));
    }
}
function checkLaunchScreen(p, out) {
    if (!p.hasIos)
        return;
    const plist = loadInfoPlist(p);
    if (!plist)
        return;
    const name = pGet(plist.root, 'UILaunchStoryboardName');
    const dict = pGet(plist.root, 'UILaunchScreen');
    const dir = plist.file.replace(/\/Info\.plist$/, '');
    if (typeof name === 'string' && name.trim()) {
        const base = name.replace(/\.storyboard$/, '');
        const exists = p.find((f) => f.startsWith(dir + '/') && f.endsWith(`/${base}.storyboard`)).length > 0 || p.exists(`${dir}/${base}.storyboard`);
        if (exists)
            return;
        out.push(finding({
            id: 'ios.launch-screen', platform: 'ios', severity: 'warning',
            title: `UILaunchStoryboardName points to "${name}" but no such storyboard exists under ${dir}`,
            detail: 'Apps without a working launch storyboard letterbox on modern iPhones and are rejected (Guideline 2.3.3 / ITMS-90475: launch storyboard required since iOS 14 SDK).',
            file: plist.file, line: plist.keyLines.get('UILaunchStoryboardName'),
            fix: `Restore ${dir}/Base.lproj/${base}.storyboard (Flutter: run \`flutter create .\`; RN: copy LaunchScreen.storyboard from the template) and make sure it is in the target's Copy Bundle Resources.`,
            docs: DOCS.launchScreen,
        }));
        return;
    }
    if (dict && typeof dict === 'object' && !Array.isArray(dict))
        return; // SwiftUI-style UILaunchScreen dict is fine
    out.push(finding({
        id: 'ios.launch-screen', platform: 'ios', severity: 'warning',
        title: 'No launch screen configured (UILaunchStoryboardName missing)',
        detail: 'Apps built with the iOS 14+ SDK must provide a launch storyboard or UILaunchScreen; otherwise the app runs letterboxed and App Store Connect rejects the build with ITMS-90475.',
        file: plist.file,
        fix: `Add <key>UILaunchStoryboardName</key><string>LaunchScreen</string> to ${plist.file} and ship ${dir}/Base.lproj/LaunchScreen.storyboard (Flutter and RN templates include one).`,
        docs: DOCS.launchScreen,
    }));
}
