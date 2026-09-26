import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
const android = resolve(root, 'android/app/src/main/res/raw');
if (existsSync(resolve(root, 'android'))) {
  mkdirSync(android, { recursive: true });
  copyFileSync(resolve(root, 'native/driver_alert.wav'), resolve(android, 'driver_alert.wav'));
}
const ios = resolve(root, 'ios/App');
if (!existsSync(ios)) {
  console.log('Android alert resource ready. Run this command again after adding the iOS project.');
  process.exit(0);
}
const delegatePath = resolve(ios, 'App/AppDelegate.swift');
let delegate = readFileSync(delegatePath, 'utf8');
const methods = [
  ['didRegisterForRemoteNotificationsWithDeviceToken', `
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
`],
  ['didFailToRegisterForRemoteNotificationsWithError', `
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`],
];
for (const [marker, code] of methods) if (!delegate.includes(marker)) {
  const index = delegate.lastIndexOf('\n}');
  if (index < 0) throw new Error('Cannot find AppDelegate class. No files written.');
  delegate = delegate.slice(0, index) + code + delegate.slice(index);
}
const projectPath = resolve(ios, 'App.xcodeproj/project.pbxproj');
let project = readFileSync(projectPath, 'utf8');
const entitlementsPath = resolve(ios, 'App/App.entitlements');
let entitlements = existsSync(entitlementsPath) ? readFileSync(entitlementsPath, 'utf8') : '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n</dict></plist>\n';
if (!entitlements.includes('aps-environment')) entitlements = entitlements.replace('</dict>', '<key>aps-environment</key><string>development</string>\n</dict>');
if (!project.includes('CODE_SIGN_ENTITLEMENTS')) project = project.replaceAll('INFOPLIST_FILE = App/Info.plist;', 'INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;');
if (!project.includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;')) throw new Error('Existing entitlements configuration needs manual review. No files written.');
if (!project.includes('driver_alert.wav')) {
  const build = 'DAA100000000000000000001', file = 'DAA100000000000000000002';
  if (!project.includes('/* Begin PBXBuildFile section */') || !project.includes('/* Begin PBXFileReference section */') || !/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(/.test(project)) throw new Error('Unrecognized Xcode project. No files written.');
  project = project.replace('/* Begin PBXBuildFile section */', `/* Begin PBXBuildFile section */\n\t\t${build} /* driver_alert.wav in Resources */ = {isa = PBXBuildFile; fileRef = ${file} /* driver_alert.wav */; };`);
  project = project.replace('/* Begin PBXFileReference section */', `/* Begin PBXFileReference section */\n\t\t${file} /* driver_alert.wav */ = {isa = PBXFileReference; lastKnownFileType = audio.wav; path = App/driver_alert.wav; sourceTree = SOURCE_ROOT; };`);
  project = project.replace(/(isa = PBXResourcesBuildPhase;[\s\S]*?files = \()/, `$1\n\t\t\t\t${build} /* driver_alert.wav in Resources */,`);
}
writeFileSync(delegatePath, delegate); writeFileSync(projectPath, project); writeFileSync(entitlementsPath, entitlements);
copyFileSync(resolve(root, 'native/driver_alert.wav'), resolve(ios, 'App/driver_alert.wav'));
console.log('Native push callbacks, entitlement, and alert sound prepared. Enable Push Notifications for the Apple App ID and refresh provisioning before signing.');
