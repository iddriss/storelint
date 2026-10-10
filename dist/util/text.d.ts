/** 1-based line number of a character offset. */
export declare function lineOf(text: string, index: number): number;
export interface LineMatch {
    line: number;
    index: number;
    match: RegExpExecArray;
}
/** First match of `re` with its 1-based line. */
export declare function findLine(text: string, re: RegExp, from?: number): LineMatch | null;
/** Replace XML/C-style comments with same-length whitespace so offsets stay valid. */
export declare function blankComments(text: string, kind: 'xml' | 'c'): string;
export declare function unquote(s: string): string;
export declare function mask(secret: string): string;
