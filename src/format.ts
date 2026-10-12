import type { Report, Severity } from './types.js';
import { SHIP_URL, VERSION } from './index.js';

export interface FormatOptions {
  color: boolean;
}

export function useColor(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): boolean {
  if (argv.includes('--no-color')) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return !!stream.isTTY;
}

function painter(enabled: boolean) {
  const wrap = (open: number, close: number) => (s: string) => (enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s);
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
    underline: wrap(4, 24),
  };
}

const LABEL: Record<Severity, string> = { blocker: 'BLOCKERS', warning: 'WARNINGS', info: 'INFO' };
const MARK: Record<Severity, string> = { blocker: '✖', warning: '▲', info: 'ℹ' };

export function formatPretty(report: Report, opts: FormatOptions): string {
  const c = painter(opts.color);
  const tint: Record<Severity, (s: string) => string> = { blocker: c.red, warning: c.yellow, info: c.cyan };
  const lines: string[] = [];
  const { project, summary, findings } = report;

  lines.push(`${c.bold('StoreLint')} ${c.dim('v' + VERSION)}  ${project.name} ${c.dim(`(${project.framework})`)}  ${c.dim(project.path)}`);
  lines.push('');

  if (project.framework === 'unknown') {
    lines.push(c.yellow('  No Flutter, React Native or Expo project detected; ran cross-platform checks only.'));
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push(c.green('  ✔ No findings. Ready for the stores.'));
    lines.push('');
  }

  for (const sev of ['blocker', 'warning', 'info'] as Severity[]) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(tint[sev](c.bold(`  ${LABEL[sev]} (${group.length})`)));
    for (const f of group) {
      const platform = f.platform === 'both' ? 'android+ios' : f.platform;
      lines.push(`  ${tint[sev](MARK[sev])} ${c.bold(f.id)} ${c.dim(`[${platform}]`)}`);
      lines.push(`    ${f.title}`);
      if (f.file) lines.push(`    ${c.dim(f.line ? `${f.file}:${f.line}` : f.file)}`);
      lines.push(`    ${c.dim('fix:')} ${f.fix}`);
      if (f.docs) lines.push(`    ${c.dim('docs:')} ${c.underline(f.docs)}`);
      lines.push('');
    }
  }

  const scoreColor = summary.score >= 90 ? c.green : summary.score >= 60 ? c.yellow : c.red;
  const scoreText = project.framework === 'unknown' ? c.yellow(c.bold('n/a')) : scoreColor(c.bold(`${summary.score}/100`));
  lines.push(
    `${c.bold('Score')} ${scoreText}  ${c.dim('·')}  ` +
      `${summary.blocker} blocker${summary.blocker === 1 ? '' : 's'}  ${c.dim('·')}  ` +
      `${summary.warning} warning${summary.warning === 1 ? '' : 's'}  ${c.dim('·')}  ${summary.info} info`,
  );
  lines.push(`Want it fixed and shipped? ${c.underline(SHIP_URL)}`);
  return lines.join('\n') + '\n';
}

const HEADING: Record<Severity, string> = { blocker: 'Blockers', warning: 'Warnings', info: 'Info' };

const mdCell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

/** GitHub-flavoured Markdown report (used for the Actions job summary and PR comments). */
export function formatMarkdown(report: Report): string {
  const { project, summary, findings } = report;
  const lines: string[] = [];
  const score = project.framework === 'unknown' ? 'n/a' : `${summary.score}/100`;
  lines.push(`## StoreLint: ${score}`);
  lines.push('');
  lines.push(
    `\`${project.name}\` (${project.framework}) · ${summary.blocker} blocker${summary.blocker === 1 ? '' : 's'} · ` +
      `${summary.warning} warning${summary.warning === 1 ? '' : 's'} · ${summary.info} info`,
  );
  lines.push('');
  if (project.framework === 'unknown') {
    lines.push('No Flutter, React Native or Expo project detected; ran cross-platform checks only.');
    lines.push('');
  }
  if (findings.length === 0) {
    lines.push('No findings. Ready for the stores.');
    lines.push('');
  }
  for (const sev of ['blocker', 'warning', 'info'] as Severity[]) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${HEADING[sev]} (${group.length})`);
    lines.push('');
    lines.push('| Check | Finding | Where | Fix |');
    lines.push('| --- | --- | --- | --- |');
    for (const f of group) {
      const id = f.docs ? `[\`${f.id}\`](${f.docs})` : `\`${f.id}\``;
      const where = f.file ? `\`${f.line ? `${f.file}:${f.line}` : f.file}\`` : '';
      lines.push(`| ${id} | ${mdCell(f.title)} | ${mdCell(where)} | ${mdCell(f.fix)} |`);
    }
    lines.push('');
  }
  lines.push(`Want it fixed and shipped? ${SHIP_URL}`);
  return lines.join('\n') + '\n';
}

const ghData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const ghProp = (s: string) => ghData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * GitHub Actions workflow commands: one `::error` per blocker and one `::warning` per warning,
 * so findings show inline on the pull request diff. Info findings stay in the report only.
 */
export function formatGithubAnnotations(report: Report, base = ''): string {
  const prefix = base && base !== '.' ? base.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') + '/' : '';
  const out: string[] = [];
  for (const f of report.findings) {
    if (f.severity === 'info') continue;
    const props = [`title=${ghProp(`StoreLint ${f.id}`)}`];
    if (f.file) props.unshift(`file=${ghProp(prefix + f.file)}`);
    if (f.file && f.line) props.splice(1, 0, `line=${f.line}`);
    out.push(`::${f.severity === 'blocker' ? 'error' : 'warning'} ${props.join(',')}::${ghData(`${f.title}. Fix: ${f.fix}`)}`);
  }
  return out.length ? out.join('\n') + '\n' : '';
}
