/** 1-based line number of a character offset. */
export function lineOf(text, index) {
    let n = 1;
    const end = Math.min(index, text.length);
    for (let i = 0; i < end; i++)
        if (text.charCodeAt(i) === 10)
            n++;
    return n;
}
/** First match of `re` with its 1-based line. */
export function findLine(text, re, from = 0) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const r = new RegExp(re.source, flags);
    r.lastIndex = from;
    const m = r.exec(text);
    if (!m)
        return null;
    return { line: lineOf(text, m.index), index: m.index, match: m };
}
/** Replace XML/C-style comments with same-length whitespace so offsets stay valid. */
export function blankComments(text, kind) {
    const re = kind === 'xml' ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
    return text.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}
export function unquote(s) {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}
export function mask(secret) {
    if (secret.length <= 10)
        return secret.slice(0, 4) + '…';
    return secret.slice(0, 8) + '…' + secret.slice(-2);
}
