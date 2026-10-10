/** 1-based line number of a character offset. */
export function lineOf(text: string, index: number): number {
  let n = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export interface LineMatch {
  line: number;
  index: number;
  match: RegExpExecArray;
}

/** First match of `re` with its 1-based line. */
export function findLine(text: string, re: RegExp, from = 0): LineMatch | null {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  r.lastIndex = from;
  const m = r.exec(text);
  if (!m) return null;
  return { line: lineOf(text, m.index), index: m.index, match: m };
}

/** Replace XML/C-style comments with same-length whitespace so offsets stay valid. */
export function blankComments(text: string, kind: 'xml' | 'c'): string {
  const re = kind === 'xml' ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return text.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

export function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function mask(secret: string): string {
  if (secret.length <= 10) return secret.slice(0, 4) + '…';
  return secret.slice(0, 8) + '…' + secret.slice(-2);
}
