function globToRegex(pattern, base, anchored, dirOnly) {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                i++;
                if (pattern[i + 1] === '/') {
                    i++;
                    out += '(?:.*/)?';
                }
                else {
                    out += '.*';
                }
            }
            else {
                out += '[^/]*';
            }
        }
        else if (ch === '?') {
            out += '[^/]';
        }
        else if (/[.+^${}()|[\]\\]/.test(ch)) {
            out += '\\' + ch;
        }
        else {
            out += ch;
        }
    }
    const prefix = base ? base.replace(/[.+*?^${}()|[\]\\]/g, '\\$&') + '/' : '';
    const body = anchored ? prefix + out : prefix + '(?:.*/)?' + out;
    const suffix = dirOnly ? '/.+' : '(?:/.*)?';
    return new RegExp('^' + body + suffix + '$');
}
export class GitignoreMatcher {
    rules = [];
    /** `base` is the posix-relative directory containing the .gitignore ('' for root). */
    add(base, content) {
        for (const raw of content.split(/\r?\n/)) {
            let line = raw.replace(/(?<!\\)\s+$/, '');
            if (!line || line.startsWith('#'))
                continue;
            let negate = false;
            if (line.startsWith('!')) {
                negate = true;
                line = line.slice(1);
            }
            let dirOnly = false;
            if (line.endsWith('/')) {
                dirOnly = true;
                line = line.slice(0, -1);
            }
            let anchored = false;
            if (line.startsWith('/')) {
                anchored = true;
                line = line.slice(1);
            }
            else if (line.includes('/')) {
                anchored = true;
            }
            if (!line)
                continue;
            this.rules.push({ re: globToRegex(line, base, anchored, dirOnly), negate });
        }
    }
    ignored(rel) {
        let result = false;
        for (const r of this.rules) {
            if (r.re.test(rel))
                result = !r.negate;
        }
        return result;
    }
}
