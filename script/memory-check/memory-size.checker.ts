import fs from 'node:fs';
import path from 'node:path';

/** Maximum accepted Memory size in binary kibibytes. */
export const MEMORY_SIZE_LIMIT_BYTES = 25 * 1024;

/** Validates the bounded project Memory used as agent startup context. */
export class MemorySizeChecker {
    /** Checks the canonical Memory file and returns its current byte size. */
    public check(projectRoot: string): number {
        const filePath = path.join(projectRoot, 'data/ai/MEMORY.md');
        if (!fs.existsSync(filePath)) {
            throw new Error(
                'data/ai/MEMORY.md is missing; create it before verification.',
            );
        }
        const status = fs.lstatSync(filePath);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(
                'data/ai/MEMORY.md must be a regular file.',
            );
        }
        if (status.size > MEMORY_SIZE_LIMIT_BYTES) {
            throw new Error(
                `data/ai/MEMORY.md is ${status.size} bytes; summarize it to at most ${MEMORY_SIZE_LIMIT_BYTES} bytes (25 KiB).`,
            );
        }
        return status.size;
    }
}
