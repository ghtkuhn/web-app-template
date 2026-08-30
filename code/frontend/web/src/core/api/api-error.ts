import type { ApiError } from './interfaces.ts';

/** Converts a rejected browser transport into the stable public API error model. */
export function toTransportApiError(error: unknown): ApiError {
    if (
        (error instanceof DOMException || error instanceof Error)
        && error.name === 'AbortError'
    ) {
        return {
            type: 'abort',
            message: 'The request was aborted.',
        };
    }
    return {
        type: 'network',
        message: error instanceof Error
            ? error.message
            : 'The network request failed.',
    };
}
