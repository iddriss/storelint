const TAG = /<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g;
function decode(s) {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, '&')
        .trim();
}
export function parsePlist(text) {
    const src = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    const keyLines = new Map();
    let pos = 0;
    function lineAt(i) {
        let n = 1;
        for (let k = 0; k < i; k++)
            if (src.charCodeAt(k) === 10)
                n++;
        return n;
    }
    function nextTag() {
        TAG.lastIndex = pos;
        for (;;) {
            const m = TAG.exec(src);
            if (!m)
                return null;
            const name = m[2];
            if (name === 'xml' || name === 'DOCTYPE')
                continue;
            return { close: m[1] === '/', name, self: m[3] === '/', index: m.index, end: m.index + m[0].length };
        }
    }
    function readText(tagName, from) {
        const closeIdx = src.indexOf(`</${tagName}>`, from);
        if (closeIdx < 0) {
            pos = src.length;
            return '';
        }
        pos = closeIdx + tagName.length + 3;
        return decode(src.slice(from, closeIdx));
    }
    function parseValue(depth) {
        const t = nextTag();
        if (!t)
            return null;
        pos = t.end;
        if (t.close)
            return null;
        switch (t.name) {
            case 'plist':
                return parseValue(depth);
            case 'dict':
                return t.self ? {} : parseDict(depth + 1);
            case 'array':
                return t.self ? [] : parseArray(depth + 1);
            case 'string':
            case 'date':
            case 'data':
                return t.self ? '' : readText(t.name, t.end);
            case 'integer':
            case 'real': {
                const n = Number(readText(t.name, t.end));
                return Number.isFinite(n) ? n : 0;
            }
            case 'true':
                return true;
            case 'false':
                return false;
            default:
                return t.self ? '' : readText(t.name, t.end);
        }
    }
    function parseDict(depth) {
        const out = {};
        for (;;) {
            const t = nextTag();
            if (!t)
                break;
            if (t.close && t.name === 'dict') {
                pos = t.end;
                break;
            }
            if (t.name !== 'key') {
                pos = t.end;
                continue;
            }
            const key = readText('key', t.end);
            if (depth === 1)
                keyLines.set(key, lineAt(t.index));
            const v = parseValue(depth);
            out[key] = v === null ? '' : v;
        }
        return out;
    }
    function parseArray(depth) {
        const out = [];
        for (;;) {
            TAG.lastIndex = pos;
            const peek = nextTag();
            if (!peek)
                break;
            if (peek.close && peek.name === 'array') {
                pos = peek.end;
                break;
            }
            const v = parseValue(depth);
            if (v !== null)
                out.push(v);
        }
        return out;
    }
    const root = parseValue(0);
    return { root, keyLines };
}
export function pGet(root, ...path) {
    let cur = root;
    for (const p of path) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur))
            return undefined;
        cur = cur[p];
    }
    return cur ?? undefined;
}
export function pHas(root, key) {
    return pGet(root, key) !== undefined;
}
