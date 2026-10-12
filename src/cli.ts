#!/usr/bin/env node
import * as fs from 'node:fs';
import { scanSync, VERSION } from './index.js';
import * as path from 'node:path';
import { formatGithubAnnotations, formatMarkdown, formatPretty, useColor } from './format.js';

const HELP = `storelint ${VERSION} — lint your Flutter / React Native / Expo app before the store does.

Usage: storelint [path] [--json | --markdown] [--github] [--ci] [--platform android|ios] [--no-color]

  path                 Project directory (default: current directory)
  --json               Print the report as JSON (schemaVersion 1)
  --markdown           Print the report as GitHub-flavoured Markdown
  --github             GitHub Actions mode: annotate the pull request with blockers and warnings
                       and write the Markdown report to the job summary
  --ci                 Exit with code 1 when any blocker is found or no app is detected
  --platform <p>       Only report android or ios findings (cross-platform ones are kept)
  --no-color           Disable ANSI colours (NO_COLOR is also respected)
  -h, --help           Show this help
  -v, --version        Print the version

Exit codes: 0 ok, 1 blockers found or no app detected (with --ci), 2 usage or scan error.
`;

interface Args {
  path: string;
  json: boolean;
  markdown: boolean;
  github: boolean;
  ci: boolean;
  platform?: 'android' | 'ios';
}

function parseArgs(argv: string[]): Args | { exit: number; message: string } {
  const args: Args = { path: '.', json: false, markdown: false, github: false, ci: false };
  let pathSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--github') args.github = true;
    else if (a === '--ci') args.ci = true;
    else if (a === '--no-color') continue;
    else if (a === '-h' || a === '--help') return { exit: 0, message: HELP };
    else if (a === '-v' || a === '--version') return { exit: 0, message: `${VERSION}\n` };
    else if (a === '--platform' || a.startsWith('--platform=')) {
      const value = a.includes('=') ? a.split('=')[1] : argv[++i];
      if (value !== 'android' && value !== 'ios') return { exit: 2, message: `--platform must be android or ios (got ${value ?? 'nothing'})\n` };
      args.platform = value;
    } else if (a.startsWith('-')) {
      return { exit: 2, message: `Unknown option: ${a}\n\n${HELP}` };
    } else if (!pathSet) {
      args.path = a;
      pathSet = true;
    } else {
      return { exit: 2, message: `Unexpected argument: ${a}\n\n${HELP}` };
    }
  }
  if (args.json && args.markdown) return { exit: 2, message: '--json and --markdown cannot be combined\n' };
  return args;
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ('exit' in parsed) {
    (parsed.exit === 0 ? process.stdout : process.stderr).write(parsed.message);
    return parsed.exit;
  }
  const st = fs.statSync(parsed.path, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) {
    process.stderr.write(`storelint: not a directory: ${parsed.path}\n`);
    return 2;
  }
  let report;
  try {
    report = scanSync(parsed.path, { platform: parsed.platform });
  } catch (err) {
    process.stderr.write(`storelint: scan failed: ${(err as Error).message}\n`);
    return 2;
  }
  if (parsed.github) {
    // Annotation paths must be relative to the repository root, which is where Actions runs the step.
    const rel = path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), path.resolve(parsed.path));
    const annotations = formatGithubAnnotations(report, rel.startsWith('..') ? '' : rel);
    // In --json mode stdout must stay parseable, so the workflow commands go to stderr (Actions reads both).
    (parsed.json ? process.stderr : process.stdout).write(annotations);
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      try {
        fs.appendFileSync(summaryFile, formatMarkdown(report));
      } catch (err) {
        process.stderr.write(`storelint: could not write the job summary: ${(err as Error).message}\n`);
      }
    }
  }
  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (parsed.markdown) {
    process.stdout.write(formatMarkdown(report));
  } else {
    process.stdout.write(formatPretty(report, { color: useColor() }));
  }
  if (parsed.ci && (report.summary.blocker > 0 || report.project.framework === 'unknown')) return 1;
  return 0;
}

// `storelint | head` closes the pipe early; that is not an error worth a stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err;
});

process.exitCode = main();
