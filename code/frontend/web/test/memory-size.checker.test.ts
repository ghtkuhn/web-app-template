import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
    MEMORY_SIZE_LIMIT_BYTES,
    MemorySizeChecker,
} from '../../../../script/memory-check/memory-size.checker.ts';

const roots: string[] = [];

/** Creates one isolated project root for a Memory fixture. */
function temporaryRoot(): string {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'memory-size-check-'),
    );
    roots.push(root);
    return root;
}

/** Writes the canonical Memory fixture with an exact byte length. */
function writeMemory(root: string, bytes: number): void {
    const filePath = path.join(root, 'data/ai/MEMORY.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(bytes, 'a'));
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Memory files at or below 25 KiB pass', () => {
    const root = temporaryRoot();
    writeMemory(root, MEMORY_SIZE_LIMIT_BYTES);

    expect(new MemorySizeChecker().check(root)).toBe(
        MEMORY_SIZE_LIMIT_BYTES,
    );
});

test('oversized Memory files fail with an actionable limit', () => {
    const root = temporaryRoot();
    writeMemory(root, MEMORY_SIZE_LIMIT_BYTES + 1);

    expect(() => new MemorySizeChecker().check(root)).toThrow(
        /summarize it to at most 25600 bytes/,
    );
});

test('missing local Memory files pass before workflow initialization', () => {
    const root = temporaryRoot();

    expect(new MemorySizeChecker().check(root)).toBeNull();
});
