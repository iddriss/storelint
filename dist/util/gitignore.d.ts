export declare class GitignoreMatcher {
    private rules;
    /** `base` is the posix-relative directory containing the .gitignore ('' for root). */
    add(base: string, content: string): void;
    ignored(rel: string): boolean;
}
