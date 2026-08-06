/** Exact streaming repetition detected in a model thinking trace. */
export interface ThinkingLoopMatch {
    /** Repeated, whitespace-normalized fragment. */
    readonly fragment: string;
    /** Number of consecutive copies that caused detection. */
    readonly repetitions: number;
}

const MIN_FRAGMENT_CHARACTERS = 16;

/** Detects an exact repeated suffix independently of stream chunk boundaries. */
export class ThinkingLoopDetector {
    private static readonly MAX_BUFFER_CHARACTERS = 32_768;
    private static readonly MAX_FRAGMENT_CHARACTERS = 512;
    private buffer = '';

    /** Creates a detector with the required consecutive repetition threshold. */
    public constructor(private readonly threshold = 10) {
        if (!Number.isInteger(threshold) || threshold < 2) {
            throw new Error('Thinking-loop threshold must be an integer of at least 2.');
        }
    }

    /** Adds one streamed thinking delta and returns the first exact loop match. */
    public append(delta: string): ThinkingLoopMatch | null {
        this.buffer = normalizeWhitespace(`${this.buffer}${delta}`).slice(
            -ThinkingLoopDetector.MAX_BUFFER_CHARACTERS,
        );
        const maximumLength = Math.min(
            ThinkingLoopDetector.MAX_FRAGMENT_CHARACTERS,
            Math.floor(this.buffer.length / this.threshold),
        );
        for (
            let length = MIN_FRAGMENT_CHARACTERS;
            length <= maximumLength;
            length += 1
        ) {
            const repeatedLength = length * this.threshold;
            const suffix = this.buffer.slice(-repeatedLength);
            const fragment = suffix.slice(0, length);
            if (
                isMeaningfulFragment(fragment) &&
                suffix === fragment.repeat(this.threshold)
            ) {
                return {
                    fragment: fragment.trim(),
                    repetitions: this.threshold,
                };
            }
        }
        return null;
    }

    /** Clears all trace content before a new agent turn or user task. */
    public reset(): void {
        this.buffer = '';
    }
}

/** Makes whitespace-only streaming differences irrelevant. */
function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, ' ');
}

/** Rejects punctuation runs and other degenerate tiny patterns. */
function isMeaningfulFragment(fragment: string): boolean {
    return fragment.trim().length >= MIN_FRAGMENT_CHARACTERS &&
        new Set(fragment.toLocaleLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).size >= 4;
}
