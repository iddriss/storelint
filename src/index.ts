import { Project } from './project.js';
import { androidChecks } from './checks/android.js';
import { iosChecks } from './checks/ios.js';
import { crossChecks } from './checks/cross.js';
import type { Finding, Report, ScanOptions, Summary } from './types.js';

export type { Finding, Report, ScanOptions, Summary, Platform, Severity, Framework } from './types.js';

export const VERSION = '0.1.0';
export const SHIP_URL = 'https://storelint.iraaj.com/ship';

const SEVERITY_ORDER = { blocker: 0, warning: 1, info: 2 } as const;
const PLATFORM_ORDER = { android: 0, ios: 1, both: 2 } as const;

export function summarize(findings: Finding[]): Summary {
  const s = { blocker: 0, warning: 0, info: 0 };
  for (const f of findings) s[f.severity]++;
  const score = Math.max(0, 100 - 25 * s.blocker - 5 * s.warning);
  return { ...s, score };
}

/**
 * Scan a Flutter / React Native / Expo project directory for store release blockers.
 * Pure over the filesystem; the only subprocess is `git ls-files` (optional).
 */
export function scanSync(path: string, options: ScanOptions = {}): Report {
  const project = new Project(path);
  let findings = [...androidChecks(project), ...iosChecks(project), ...crossChecks(project)];
  if (options.platform) {
    findings = findings.filter((f) => f.platform === options.platform || f.platform === 'both');
  }
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform] ||
      a.id.localeCompare(b.id) ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    project: { path, framework: project.framework, name: project.name },
    summary: summarize(findings),
    findings,
  };
}

export async function scan(path: string, options: ScanOptions = {}): Promise<Report> {
  return scanSync(path, options);
}

export default scan;
