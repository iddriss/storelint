import { SHIP_URL, VERSION } from './index.js';
export function useColor(stream = process.stdout, env = process.env, argv = process.argv) {
    if (argv.includes('--no-color'))
        return false;
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '')
        return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0')
        return true;
    if (env.TERM === 'dumb')
        return false;
    return !!stream.isTTY;
}
function painter(enabled) {
    const wrap = (open, close) => (s) => (enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s);
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
const LABEL = { blocker: 'BLOCKERS', warning: 'WARNINGS', info: 'INFO' };
const MARK = { blocker: '✖', warning: '▲', info: 'ℹ' };
export function formatPretty(report, opts) {
    const c = painter(opts.color);
    const tint = { blocker: c.red, warning: c.yellow, info: c.cyan };
    const lines = [];
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
    for (const sev of ['blocker', 'warning', 'info']) {
        const group = findings.filter((f) => f.severity === sev);
        if (group.length === 0)
            continue;
        lines.push(tint[sev](c.bold(`  ${LABEL[sev]} (${group.length})`)));
        for (const f of group) {
            const platform = f.platform === 'both' ? 'android+ios' : f.platform;
            lines.push(`  ${tint[sev](MARK[sev])} ${c.bold(f.id)} ${c.dim(`[${platform}]`)}`);
            lines.push(`    ${f.title}`);
            if (f.file)
                lines.push(`    ${c.dim(f.line ? `${f.file}:${f.line}` : f.file)}`);
            lines.push(`    ${c.dim('fix:')} ${f.fix}`);
            if (f.docs)
                lines.push(`    ${c.dim('docs:')} ${c.underline(f.docs)}`);
            lines.push('');
        }
    }
    const scoreColor = summary.score >= 90 ? c.green : summary.score >= 60 ? c.yellow : c.red;
    const scoreText = project.framework === 'unknown' ? c.yellow(c.bold('n/a')) : scoreColor(c.bold(`${summary.score}/100`));
    lines.push(`${c.bold('Score')} ${scoreText}  ${c.dim('·')}  ` +
        `${summary.blocker} blocker${summary.blocker === 1 ? '' : 's'}  ${c.dim('·')}  ` +
        `${summary.warning} warning${summary.warning === 1 ? '' : 's'}  ${c.dim('·')}  ${summary.info} info`);
    lines.push(`Want it fixed and shipped? ${c.underline(SHIP_URL)}`);
    return lines.join('\n') + '\n';
}
