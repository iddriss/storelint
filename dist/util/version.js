/** Parse the first `x[.y[.z]]` found in a string (tolerates ^ ~ >= and "r28" style). */
export function parseVersion(input) {
    if (!input)
        return null;
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(input);
    if (!m)
        return null;
    return {
        major: Number(m[1]),
        minor: m[2] === undefined ? 0 : Number(m[2]),
        patch: m[3] === undefined ? 0 : Number(m[3]),
        raw: m[0],
    };
}
export function cmpVersion(a, b) {
    if (a.major !== b.major)
        return a.major - b.major;
    if (a.minor !== b.minor)
        return a.minor - b.minor;
    return a.patch - b.patch;
}
export function versionLt(a, b) {
    const va = typeof a === 'string' ? parseVersion(a) : a;
    const vb = parseVersion(b);
    if (!va || !vb)
        return false;
    return cmpVersion(va, vb) < 0;
}
/** Lower bound of a dart/npm style constraint: ">=3.0.0 <4.0.0", "^3.5.0", "~52.0.0", "3.1.0". */
export function lowerBound(constraint) {
    if (!constraint)
        return null;
    const c = constraint.trim();
    const ge = /(?:>=|\^|~|>)?\s*(\d+\.\d+(?:\.\d+)?)/.exec(c);
    return ge ? parseVersion(ge[1]) : null;
}
