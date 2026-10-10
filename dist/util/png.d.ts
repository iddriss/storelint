/** Width/height of a PNG file, or null if not a readable PNG. */
export declare function pngSize(absPath: string): {
    width: number;
    height: number;
} | null;
