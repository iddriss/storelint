import { lineOf } from './text.js';
/** Extract the `{ ... }` body following the first match of `headerRe` (must end at the `{`). */
export function extractBlock(text, headerRe, from = 0) {
    const flags = headerRe.flags.includes('g') ? headerRe.flags : headerRe.flags + 'g';
    const re = new RegExp(headerRe.source, flags);
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m)
        return null;
    const open = text.indexOf('{', m.index + m[0].length - 1);
    if (open < 0)
        return null;
    let depth = 0;
    let quote = null;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\')
                i++;
            else if (ch === quote)
                quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            const nl = text.indexOf('\n', i);
            i = nl < 0 ? text.length : nl;
            continue;
        }
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return { body: text.slice(open + 1, i), start: open + 1, end: i };
        }
    }
    return null;
}
/** `key = value` / `key value` / `key(value)` on its own line (Groovy or Kotlin DSL). */
export function gradleAssign(text, key, offset = 0) {
    const re = new RegExp(`^[ \\t]*(?:${key})\\s*(?:=|\\(|\\s)\\s*([^\\n]+)`, 'm');
    const m = re.exec(text);
    if (!m)
        return null;
    let expr = m[1].trim();
    expr = expr.replace(/\/\/.*$/, '').replace(/\)\s*$/, '').trim();
    return { expr, line: lineOf(text, offset + m.index) };
}
/** Parse `key=value` lines of gradle.properties. */
export function parseProperties(text) {
    const out = new Map();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!'))
            continue;
        const idx = line.search(/[=:]/);
        if (idx <= 0)
            continue;
        out.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    return out;
}
/** Very small TOML reader for gradle/libs.versions.toml: returns [versions] and [libraries] entries. */
export function parseVersionsToml(text) {
    const versions = new Map();
    const libraries = new Map();
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line)
            continue;
        const sec = /^\[(\w+)\]$/.exec(line);
        if (sec) {
            section = sec[1];
            continue;
        }
        const kv = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
        if (!kv)
            continue;
        const key = kv[1];
        const val = kv[2].trim();
        if (section === 'versions') {
            const s = /^["']([^"']+)["']$/.exec(val);
            if (s)
                versions.set(key, s[1]);
        }
        else if (section === 'libraries') {
            let module = '';
            let version = null;
            const simple = /^["']([^"':]+:[^"':]+):([^"']+)["']$/.exec(val);
            if (simple) {
                module = simple[1];
                version = simple[2];
            }
            else {
                const mod = /module\s*=\s*["']([^"']+)["']/.exec(val);
                const grp = /group\s*=\s*["']([^"']+)["']/.exec(val);
                const nam = /name\s*=\s*["']([^"']+)["']/.exec(val);
                if (mod)
                    module = mod[1];
                else if (grp && nam)
                    module = `${grp[1]}:${nam[1]}`;
                const ref = /version\.ref\s*=\s*["']([^"']+)["']/.exec(val);
                const ver = /version\s*=\s*["']([^"']+)["']/.exec(val);
                if (ref)
                    version = versions.get(ref[1]) ?? null;
                else if (ver)
                    version = ver[1];
            }
            if (module)
                libraries.set(key, { module, version });
        }
    }
    return { versions, libraries };
}
