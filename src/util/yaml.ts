/**
 * Tiny YAML subset parser: enough for pubspec.yaml / pubspec.lock.
 * Supports nested maps, scalar values, simple lists of scalars, quotes and comments.
 * Anchors, multi-line scalars and flow mappings are not supported (values kept as strings).
 */
export type YValue = string | null | YMap | YValue[];
export interface YMap {
  [key: string]: YValue;
}

interface Frame {
  indent: number;
  node: YMap | YValue[];
  owner?: { map: YMap; key: string };
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseYaml(text: string): YMap {
  const root: YMap = {};
  const stack: Frame[] = [{ indent: -1, node: root }];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = /^ */.exec(raw)![0].length;
    const line = stripComment(raw.slice(indent)).replace(/\s+$/, '');
    if (!line) continue;
    const isItem = line === '-' || line.startsWith('- ');

    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (indent > top.indent) break;
      // `key:` followed by `- item` at the same indent belongs to that key.
      if (isItem && indent === top.indent && top.owner && !Array.isArray(top.node) && Object.keys(top.node).length === 0) break;
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (isItem) {
      let arr: YValue[];
      if (Array.isArray(top.node)) {
        arr = top.node;
      } else if (top.owner && Object.keys(top.node).length === 0) {
        arr = [];
        top.owner.map[top.owner.key] = arr;
        top.node = arr;
      } else {
        continue; // list where a map was expected; ignore
      }
      arr.push(line === '-' ? null : scalar(line.slice(2)));
      continue;
    }

    const m = /^("[^"]*"|'[^']*'|[^\s:][^:]*?)\s*:(?:\s+(.*)|$)/.exec(line);
    if (!m || Array.isArray(top.node)) continue;
    const key = scalar(m[1]);
    const val = m[2];
    const map = top.node;
    if (val === undefined || val === '') {
      const child: YMap = {};
      map[key] = child;
      stack.push({ indent, node: child, owner: { map, key } });
    } else if (val.trim() === '[]') {
      map[key] = [];
    } else if (val.trim() === '{}') {
      map[key] = {};
    } else {
      map[key] = scalar(val);
    }
  }
  return root;
}

export function yGet(node: YValue | undefined, ...path: string[]): YValue | undefined {
  let cur: YValue | undefined = node;
  for (const p of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function yString(node: YValue | undefined, ...path: string[]): string | null {
  const v = yGet(node, ...path);
  return typeof v === 'string' ? v : null;
}

export function yKeys(node: YValue | undefined, ...path: string[]): string[] {
  const v = yGet(node, ...path);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.keys(v);
}
