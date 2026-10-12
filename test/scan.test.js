import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, scanSync, summarize, formatMarkdown, formatGithubAnnotations } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixtures = path.join(here, 'fixtures');
const cli = path.join(root, 'dist', 'cli.js');
const fx = (name) => path.join(fixtures, name);

const ids = (report) => report.findings.map((f) => f.id);
const has = (report, id, severity) => report.findings.some((f) => f.id === id && (!severity || f.severity === severity));
const count = (report, id) => report.findings.filter((f) => f.id === id).length;

const ALL_IDS = [
  'android.target-sdk', 'android.page-size-16kb', 'android.min-sdk', 'android.application-id', 'android.debug-signing',
  'android.keystore-in-repo', 'android.cleartext', 'android.exported', 'android.play-core-legacy', 'android.ads-id',
  'android.permissions-dangerous', 'android.version-code', 'android.proguard', 'android.play-billing',
  'ios.deployment-target', 'ios.privacy-manifest', 'ios.required-reason-apis', 'ios.usage-descriptions', 'ios.encryption-flag',
  'ios.ats', 'ios.bundle-id', 'ios.xcode-version', 'ios.push-entitlement', 'ios.launch-screen',
  'app.secrets', 'app.dotenv-tracked', 'app.placeholder-config', 'app.icons', 'app.name', 'app.version-mismatch',
  'app.flutter-version', 'app.rn-version', 'app.expo', 'app.unknown-framework',
];

function assertReportShape(report) {
  assert.deepEqual(Object.keys(report), ['schemaVersion', 'scannedAt', 'project', 'summary', 'findings']);
  assert.equal(report.schemaVersion, 1);
  assert.ok(!Number.isNaN(Date.parse(report.scannedAt)));
  assert.deepEqual(Object.keys(report.project), ['path', 'framework', 'name']);
  assert.ok(['flutter', 'react-native', 'expo', 'unknown'].includes(report.project.framework));
  assert.deepEqual(Object.keys(report.summary), ['blocker', 'warning', 'info', 'score']);
  const s = { blocker: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    assert.match(f.id, /^(android|ios|app)\.[a-z0-9-]+$/, `bad id ${f.id}`);
    assert.ok(ALL_IDS.includes(f.id), `unknown id ${f.id}`);
    assert.ok(['android', 'ios', 'both'].includes(f.platform));
    assert.ok(['blocker', 'warning', 'info'].includes(f.severity));
    assert.ok(f.title && f.detail && f.fix, `${f.id} needs title/detail/fix`);
    if (f.file !== undefined) {
      assert.equal(typeof f.file, 'string');
      assert.ok(!f.file.startsWith('/') && !f.file.includes('\\'), `file must be posix-relative: ${f.file}`);
    }
    if (f.line !== undefined) assert.ok(Number.isInteger(f.line) && f.line > 0, `bad line for ${f.id}`);
    if (f.docs !== undefined) assert.match(f.docs, /^https:\/\//);
    for (const k of Object.keys(f)) assert.ok(['id', 'platform', 'severity', 'title', 'detail', 'file', 'line', 'fix', 'docs'].includes(k), `unexpected key ${k}`);
    s[f.severity]++;
  }
  const expected = report.project.framework === 'unknown' ? 0 : Math.max(0, 100 - 25 * s.blocker - 5 * s.warning);
  assert.deepEqual(report.summary, { ...s, score: expected });
}

describe('flutter-bad fixture', () => {
  let r;
  before(async () => {
    r = await scan(fx('flutter-bad'));
  });

  test('report shape and project detection', () => {
    assertReportShape(r);
    assert.equal(r.project.framework, 'flutter');
    assert.equal(r.project.name, 'flutter_app');
    assert.equal(r.project.path, fx('flutter-bad'));
    assert.equal(r.summary.score, 0);
    assert.ok(r.summary.blocker >= 15, `expected many blockers, got ${r.summary.blocker}`);
  });

  test('android blockers', () => {
    assert.ok(has(r, 'android.target-sdk', 'blocker'));
    const t = r.findings.find((f) => f.id === 'android.target-sdk' && f.severity === 'blocker');
    assert.match(t.title, /targetSdk is 33; Google Play requires 35/);
    assert.equal(t.file, 'android/app/build.gradle');
    assert.ok(t.line > 0);
    assert.ok(has(r, 'android.target-sdk', 'warning'), 'compileSdk 33 warning');
    assert.ok(has(r, 'android.page-size-16kb', 'blocker'));
    assert.ok(has(r, 'android.application-id', 'blocker'));
    assert.ok(has(r, 'android.debug-signing', 'blocker'));
    assert.ok(has(r, 'android.keystore-in-repo', 'blocker'));
    assert.ok(r.findings.some((f) => f.id === 'android.keystore-in-repo' && f.file === 'android/upload-keystore.jks'));
    assert.ok(r.findings.some((f) => f.id === 'android.keystore-in-repo' && f.file === 'android/key.properties'));
    assert.equal(count(r, 'android.exported'), 2, 'activity and receiver without exported');
    assert.ok(has(r, 'android.play-billing', 'blocker'));
  });

  test('android warnings and info', () => {
    assert.ok(has(r, 'android.min-sdk', 'warning'));
    assert.ok(has(r, 'android.cleartext', 'warning'));
    assert.ok(has(r, 'android.play-core-legacy', 'warning'));
    assert.ok(has(r, 'android.ads-id', 'warning'));
    assert.ok(has(r, 'android.proguard', 'warning'));
    assert.ok(has(r, 'android.permissions-dangerous', 'info'));
    assert.match(r.findings.find((f) => f.id === 'android.permissions-dangerous').title, /CAMERA/);
    assert.ok(has(r, 'android.version-code', 'info'));
  });

  test('ios findings', () => {
    assert.ok(has(r, 'ios.deployment-target', 'blocker'), 'iOS 11.0 is a blocker');
    assert.ok(has(r, 'ios.privacy-manifest', 'blocker'));
    assert.ok(has(r, 'ios.bundle-id', 'blocker'));
    assert.ok(has(r, 'ios.push-entitlement', 'blocker'));
    const usage = r.findings.filter((f) => f.id === 'ios.usage-descriptions' && f.severity === 'blocker');
    const keys = usage.map((f) => f.title.split(' ')[0]);
    for (const k of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSFaceIDUsageDescription', 'NSBluetoothAlwaysUsageDescription']) {
      assert.ok(keys.includes(k), `missing usage description finding for ${k}`);
    }
    assert.ok(has(r, 'ios.usage-descriptions', 'info'), 'permission_handler note');
    assert.ok(has(r, 'ios.ats', 'warning'));
    assert.ok(has(r, 'ios.xcode-version', 'warning'));
    assert.ok(has(r, 'ios.launch-screen', 'warning'));
    assert.ok(has(r, 'ios.encryption-flag', 'info'));
    assert.ok(!has(r, 'ios.required-reason-apis'), 'no manifest means no required-reason finding');
  });

  test('cross findings', () => {
    assert.ok(has(r, 'app.secrets', 'blocker'));
    const secret = r.findings.find((f) => f.id === 'app.secrets');
    assert.equal(secret.file, 'lib/config.dart');
    assert.ok(!secret.title.includes('FAKEFAKE12345678'), 'secret must be masked');
    assert.ok(has(r, 'app.dotenv-tracked', 'blocker'));
    assert.ok(has(r, 'app.placeholder-config', 'warning'));
    assert.ok(r.findings.some((f) => f.id === 'app.placeholder-config' && /YOUR_API_KEY/.test(f.title)));
    assert.ok(r.findings.some((f) => f.id === 'app.icons' && f.platform === 'android'));
    assert.ok(r.findings.some((f) => f.id === 'app.icons' && f.platform === 'ios'));
    assert.ok(has(r, 'app.name', 'info'));
    assert.ok(has(r, 'app.flutter-version', 'warning'));
    assert.ok(!has(r, 'app.unknown-framework'));
    assert.ok(!has(r, 'app.expo'));
    assert.ok(!has(r, 'app.rn-version'));
  });

  test('findings are sorted blockers first', () => {
    const order = { blocker: 0, warning: 1, info: 2 };
    for (let i = 1; i < r.findings.length; i++) {
      assert.ok(order[r.findings[i - 1].severity] <= order[r.findings[i].severity]);
    }
  });
});

describe('flutter-good fixture', () => {
  test('scores 100 with no blockers or warnings', async () => {
    const r = await scan(fx('flutter-good'));
    assertReportShape(r);
    assert.equal(r.project.framework, 'flutter');
    assert.equal(r.project.name, 'good_app');
    assert.equal(r.summary.blocker, 0, JSON.stringify(ids(r)));
    assert.equal(r.summary.warning, 0, JSON.stringify(ids(r)));
    assert.equal(r.summary.score, 100);
    for (const id of ['android.target-sdk', 'android.page-size-16kb', 'android.debug-signing', 'android.keystore-in-repo', 'android.exported',
      'android.application-id', 'android.proguard', 'ios.privacy-manifest', 'ios.required-reason-apis', 'ios.usage-descriptions',
      'ios.bundle-id', 'ios.push-entitlement', 'ios.launch-screen', 'ios.encryption-flag', 'app.secrets', 'app.dotenv-tracked',
      'app.icons', 'app.name', 'app.flutter-version', 'app.placeholder-config']) {
      assert.ok(!has(r, id), `unexpected ${id}`);
    }
  });
});

describe('react-native bare fixture', () => {
  let r;
  before(async () => {
    r = await scan(fx('rn-bare'));
  });

  test('detection and resolution through rootProject.ext', () => {
    assertReportShape(r);
    assert.equal(r.project.framework, 'react-native');
    assert.equal(r.project.name, 'MyApp');
    const t = r.findings.find((f) => f.id === 'android.target-sdk' && f.severity === 'blocker');
    assert.ok(t, 'targetSdk 33 via rootProject.ext');
    assert.equal(t.file, 'android/build.gradle');
  });

  test('expected findings', () => {
    assert.ok(has(r, 'android.page-size-16kb', 'blocker'), 'RN 0.72 bundles AGP < 8.5.1');
    assert.ok(has(r, 'android.debug-signing', 'blocker'));
    assert.ok(has(r, 'ios.bundle-id', 'blocker'));
    assert.match(r.findings.find((f) => f.id === 'ios.bundle-id').title, /org\.reactjs\.native\.example/);
    assert.ok(has(r, 'ios.privacy-manifest', 'blocker'));
    assert.ok(has(r, 'ios.usage-descriptions', 'blocker'), 'react-native-image-picker needs camera/photos strings');
    assert.ok(has(r, 'ios.deployment-target', 'warning'), '12.4 is a warning not a blocker');
    assert.ok(has(r, 'ios.xcode-version', 'warning'));
    assert.ok(has(r, 'app.rn-version', 'warning'));
    assert.ok(has(r, 'app.version-mismatch', 'info'));
    assert.ok(r.findings.some((f) => f.id === 'app.placeholder-config' && /localhost/.test(f.title)));
    assert.ok(r.findings.some((f) => f.id === 'app.icons' && f.platform === 'ios'));
    assert.ok(has(r, 'app.name', 'info'));
  });

  test('absent findings', () => {
    assert.ok(!has(r, 'android.keystore-in-repo'), 'debug.keystore is not a secret');
    assert.ok(!has(r, 'android.exported'));
    assert.ok(!has(r, 'android.application-id'));
    assert.ok(!has(r, 'android.min-sdk'));
    assert.ok(!has(r, 'android.proguard'), 'minifyEnabled is not literally true');
    assert.ok(!has(r, 'ios.ats'));
    assert.ok(!has(r, 'ios.launch-screen'));
    assert.ok(!has(r, 'app.flutter-version'));
    assert.ok(!has(r, 'app.expo'));
  });
});

describe('expo managed fixture', () => {
  let r;
  before(async () => {
    r = await scan(fx('expo-managed'));
  });

  test('detection', () => {
    assertReportShape(r);
    assert.equal(r.project.framework, 'expo');
    assert.equal(r.project.name, 'Expo Demo');
  });

  test('expected findings', () => {
    const e = r.findings.find((f) => f.id === 'app.expo');
    assert.ok(e && e.severity === 'blocker' && e.platform === 'android', 'android.package missing');
    assert.match(e.title, /android\.package/);
    assert.ok(has(r, 'ios.usage-descriptions', 'blocker'), 'react-native-ble-plx without NSBluetoothAlwaysUsageDescription in ios.infoPlist');
    assert.ok(has(r, 'android.target-sdk', 'warning'), 'SDK 52 default targetSdk 35 is only a warning');
    assert.ok(has(r, 'android.version-code', 'info'));
    assert.ok(has(r, 'ios.encryption-flag', 'info'));
  });

  test('absent findings (managed by Expo)', () => {
    for (const id of ['android.page-size-16kb', 'android.debug-signing', 'android.exported', 'ios.privacy-manifest', 'ios.push-entitlement',
      'ios.bundle-id', 'ios.xcode-version', 'ios.launch-screen', 'app.icons', 'app.rn-version', 'app.secrets', 'app.dotenv-tracked']) {
      assert.ok(!has(r, id), `unexpected ${id}: ${JSON.stringify(ids(r))}`);
    }
    assert.ok(!r.findings.some((f) => f.id === 'ios.usage-descriptions' && /expo-camera/.test(f.title)), 'expo-camera config plugin supplies its own strings');
    assert.ok(!r.findings.some((f) => f.id === 'app.expo' && f.platform === 'ios'));
  });
});

describe('options and edge cases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storelint-test-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('--platform filter keeps cross-platform findings and recomputes the summary', async () => {
    const r = await scan(fx('flutter-bad'), { platform: 'ios' });
    assert.ok(r.findings.length > 0);
    assert.ok(r.findings.every((f) => f.platform === 'ios' || f.platform === 'both'));
    assert.ok(has(r, 'app.secrets'));
    assert.ok(!has(r, 'android.target-sdk'));
    assert.deepEqual(r.summary, summarize(r.findings));
    const a = scanSync(fx('flutter-bad'), { platform: 'android' });
    assert.ok(a.findings.every((f) => f.platform === 'android' || f.platform === 'both'));
    assert.ok(has(a, 'android.target-sdk'));
  });

  test('unknown project still runs cross checks and says so', async () => {
    const dir = path.join(tmp, 'unknown');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# nothing here\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    const r = await scan(dir);
    assertReportShape(r);
    assert.equal(r.project.framework, 'unknown');
    assert.equal(r.project.name, 'unknown');
    assert.ok(has(r, 'app.unknown-framework', 'info'));
    assert.ok(has(r, 'app.dotenv-tracked', 'blocker'), 'cross checks still run');
    assert.equal(r.summary.score, 0);
  });

  test('works outside a git repository (gitignore fallback)', async () => {
    const dir = path.join(tmp, 'nogit');
    fs.cpSync(fx('flutter-bad'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), '*.jks\n');
    const r = await scan(dir);
    assert.ok(has(r, 'app.secrets'), 'secrets are still scanned');
    assert.ok(has(r, 'app.dotenv-tracked'));
    assert.ok(r.findings.some((f) => f.id === 'android.keystore-in-repo' && f.file === 'android/key.properties'));
    assert.ok(!r.findings.some((f) => f.id === 'android.keystore-in-repo' && f.file.endsWith('.jks')), '.gitignore is honoured');
  });

  test('rejects a non-directory', async () => {
    await assert.rejects(() => scan(path.join(tmp, 'does-not-exist')), /Not a directory/);
  });

  test('score formula floors at zero', () => {
    const mk = (severity) => ({ id: 'app.name', platform: 'both', severity, title: '', detail: '', fix: '' });
    assert.deepEqual(summarize([]), { blocker: 0, warning: 0, info: 0, score: 100 });
    assert.equal(summarize([mk('info')], 'unknown').score, 0, 'no app, no score');
    assert.deepEqual(summarize([mk('warning'), mk('info')]), { blocker: 0, warning: 1, info: 1, score: 95 });
    assert.deepEqual(summarize([mk('blocker'), mk('blocker'), mk('blocker'), mk('blocker'), mk('blocker')]).score, 0);
  });
});

describe('CLI', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env } });

  test('--json prints the report', () => {
    const res = run([fx('expo-managed'), '--json']);
    assert.equal(res.status, 0, res.stderr);
    const r = JSON.parse(res.stdout);
    assertReportShape(r);
    assert.equal(r.project.framework, 'expo');
  });

  test('--ci exits 1 only when blockers exist', () => {
    assert.equal(run([fx('flutter-bad'), '--ci']).status, 1);
    assert.equal(run([fx('flutter-good'), '--ci']).status, 0);
    assert.equal(run([fx('flutter-bad')]).status, 0, 'without --ci blockers do not fail');
  });

  test('pretty output has severity groups, score and footer, no ANSI when NO_COLOR', () => {
    const res = run([fx('flutter-bad')]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /BLOCKERS \(\d+\)/);
    assert.match(res.stdout, /WARNINGS \(\d+\)/);
    assert.match(res.stdout, /INFO \(\d+\)/);
    assert.match(res.stdout, /Score 0\/100/);
    assert.ok(res.stdout.includes('Want it fixed and shipped? https://storelint.embracetech.org/ship'));
    assert.ok(!/\u001b\[/.test(res.stdout), 'NO_COLOR must disable ANSI');
    const coloured = run([fx('flutter-good')], { NO_COLOR: '', FORCE_COLOR: '1' });
    assert.ok(/\u001b\[/.test(coloured.stdout), 'FORCE_COLOR enables ANSI');
  });

  test('unknown project is reported in pretty mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storelint-cli-'));
    try {
      const res = run([dir]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /No Flutter, React Native or Expo project detected/);
      assert.match(res.stdout, /Score n\/a/);
      assert.equal(run([dir, '--ci']).status, 1, '--ci fails when no app is detected');
      assert.ok(!/\d+\/100/.test(res.stdout), 'no score without an app');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--platform filters and validates', () => {
    const ok = run([fx('flutter-bad'), '--platform', 'ios', '--json']);
    assert.equal(ok.status, 0);
    assert.ok(JSON.parse(ok.stdout).findings.every((f) => f.platform !== 'android'));
    const eq = run([fx('flutter-bad'), '--platform=android', '--json']);
    assert.ok(JSON.parse(eq.stdout).findings.every((f) => f.platform !== 'ios'));
    assert.equal(run([fx('flutter-bad'), '--platform', 'web']).status, 2);
  });

  test('--markdown prints a GitHub-flavoured report', () => {
    const res = run([fx('flutter-bad'), '--markdown']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^## StoreLint: 0\/100/);
    assert.match(res.stdout, /### Blockers \(\d+\)/);
    assert.match(res.stdout, /\| \[`android\.target-sdk`\]\(https:\/\/[^)]+\) \| targetSdk is 33/);
    assert.ok(res.stdout.includes('Want it fixed and shipped? https://storelint.embracetech.org/ship'));
    const rows = res.stdout.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Check') && !l.startsWith('| ---'));
    assert.equal(rows.length, scanSync(fx('flutter-bad')).findings.length, 'one table row per finding');
    for (const row of rows) assert.equal(row.replace(/\\\|/g, '').split('|').length, 6, `4 cells: ${row}`);
    assert.match(formatMarkdown(scanSync(fx('flutter-good'))), /^## StoreLint: \d+\/100/);
    assert.equal(run([fx('flutter-bad'), '--markdown', '--json']).status, 2);
  });

  test('--github emits annotations and writes the job summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storelint-gh-'));
    try {
      const summary = path.join(dir, 'summary.md');
      const report = scanSync(fx('flutter-bad'));
      const res = run([fx('flutter-bad'), '--github', '--ci'], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: root });
      assert.equal(res.status, 1);
      const errors = res.stdout.split('\n').filter((l) => l.startsWith('::error '));
      const warnings = res.stdout.split('\n').filter((l) => l.startsWith('::warning '));
      assert.equal(errors.length, report.summary.blocker);
      assert.equal(warnings.length, report.summary.warning);
      assert.ok(errors.some((l) => /^::error file=test\/fixtures\/flutter-bad\/android\/app\/build\.gradle,line=\d+,title=StoreLint android\.target-sdk::targetSdk is 33/.test(l)), 'paths are relative to the workspace');
      assert.match(res.stdout, /BLOCKERS \(\d+\)/, 'pretty report still printed');
      assert.match(fs.readFileSync(summary, 'utf8'), /^## StoreLint: 0\/100/);
      const json = run([fx('flutter-bad'), '--github', '--json'], { GITHUB_STEP_SUMMARY: '', GITHUB_WORKSPACE: root });
      assert.equal(JSON.parse(json.stdout).schemaVersion, 1, 'stdout stays valid JSON');
      assert.match(json.stderr, /^::error /m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('annotation text is escaped for workflow commands', () => {
    const out = formatGithubAnnotations({
      schemaVersion: 1, scannedAt: '', project: { path: '.', framework: 'flutter', name: 'x' },
      summary: { blocker: 1, warning: 0, info: 1, score: 75 },
      findings: [
        { id: 'app.secrets', platform: 'both', severity: 'blocker', title: '100% bad\nline two', detail: 'd', file: 'lib/a,b:c.dart', line: 3, fix: 'do it' },
        { id: 'app.name', platform: 'both', severity: 'info', title: 't', detail: 'd', fix: 'f' },
      ],
    }, 'apps/mobile');
    assert.equal(out, '::error file=apps/mobile/lib/a%2Cb%3Ac.dart,line=3,title=StoreLint app.secrets::100%25 bad%0Aline two. Fix: do it\n');
  });

  test('action.yml runs the bundled CLI in GitHub mode', () => {
    const action = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
    assert.match(action, /using: composite/);
    assert.match(action, /dist\/cli\.js/);
    assert.match(action, /--github/);
  });

  test('usage errors and help', () => {
    assert.equal(run(['--bogus']).status, 2);
    assert.equal(run([path.join(os.tmpdir(), 'storelint-missing-dir')]).status, 2);
    const help = run(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: storelint/);
    assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/);
  });

  test('bin has a node shebang and is executable from the package manifest', () => {
    assert.ok(fs.readFileSync(cli, 'utf8').startsWith('#!/usr/bin/env node'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.bin.storelint, 'dist/cli.js');
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'zero runtime dependencies');
    assert.ok(!fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').some((l) => /^\/?dist\/?$/.test(l.trim())), 'dist must be committed');
    execFileSync(process.execPath, [cli, '--version']);
  });
});
