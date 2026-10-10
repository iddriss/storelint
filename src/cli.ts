#!/usr/bin/env node
import * as fs from 'node:fs';
import { scanSync, VERSION } from './index.js';
import { formatPretty, useColor } from './format.js';

const HELP = `storelint ${VERSION} — lint your Flutter / React Native / Expo app before the store does.

Usage: storelint [path] [--json] [--ci] [--platform android|ios] [--no-color]

  path                 Project directory (default: current directory)
  --json               Print the report as JSON (schemaVersion 1)
  --ci                 Exit with code 1 when any blocker is found
  --platform <p>       Only report android or ios findings (cross-platform ones are kept)
  --no-color           Disable ANSI colours (NO_COLOR is also respected)
  -h, --help           Show this help
  -v, --version        Print the version

Exit codes: 0 ok, 1 blockers found (with --ci), 2 usage or scan error.
`;

interface Args {
  path: string;
  json: boolean;
  ci: boolean;
  platform?: 'android' | 'ios';
}

function parseArgs(argv: string[]): Args | { exit: number; message: string } {
  const args: Args = { path: '.', json: false, ci: false };
  let pathSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
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
  if (parsed.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatPretty(report, { color: useColor() }));
  }
  if (parsed.ci && report.summary.blocker > 0) return 1;
  return 0;
}

process.exitCode = main();
