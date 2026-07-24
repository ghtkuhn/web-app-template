import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
    findProjectRoot,
    guardBackendBaseToolCall,
} from '../../../../little-coder/extensions/backend-base-guard/index.ts';

const temporaryRoots: string[] = [];

/** Creates a minimal project containing the protected backend directory. */
function createProject(): string {
    const projectRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'backend-base-guard-'),
    );
    temporaryRoots.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}');
    fs.mkdirSync(
        path.join(projectRoot, 'code/backend/src/base'),
        { recursive: true },
    );
    return projectRoot;
}

afterEach(() => {
    for (const projectRoot of temporaryRoots.splice(0)) {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

describe('Little Coder backend Base guard', () => {
    test('finds the owning project from nested directories', () => {
        const projectRoot = createProject();
        const nested = path.join(projectRoot, 'code/backend/src/module');
        fs.mkdirSync(nested, { recursive: true });

        expect(findProjectRoot(nested)).toBe(projectRoot);
    });

    test('blocks creates and edits below backend Base', () => {
        const projectRoot = createProject();
        for (const [toolName, input] of [
            ['write', { path: 'code/backend/src/base/new.ts' }],
            ['edit', { file_path: 'code/backend/src/base/interfaces.ts' }],
            ['patch', { target: 'code/backend/src/base/base.store.ts' }],
        ] as const) {
            expect(
                guardBackendBaseToolCall(
                    toolName,
                    input,
                    projectRoot,
                    projectRoot,
                ),
            ).toMatchObject({ block: true });
        }
    });

    test('blocks deletion, movement, and directory creation targets', () => {
        const projectRoot = createProject();
        for (const [toolName, input] of [
            ['remove', { path: 'code/backend/src/base/base.store.ts' }],
            ['move', { destination: 'code/backend/src/base/moved.ts' }],
            ['mkdir', { directory: 'code/backend/src/base/nested' }],
        ] as const) {
            expect(
                guardBackendBaseToolCall(
                    toolName,
                    input,
                    projectRoot,
                    projectRoot,
                ),
            ).toMatchObject({ block: true });
        }
    });

    test('blocks mutation through a symbolic-link parent', () => {
        const projectRoot = createProject();
        fs.symlinkSync(
            path.join(projectRoot, 'code/backend/src/base'),
            path.join(projectRoot, 'base-link'),
        );

        expect(
            guardBackendBaseToolCall(
                'write',
                { path: 'base-link/new.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toMatchObject({ block: true });
    });

    test('blocks writes through a dangling symbolic link into Base', () => {
        const projectRoot = createProject();
        fs.symlinkSync(
            path.join(projectRoot, 'code/backend/src/base/new.ts'),
            path.join(projectRoot, 'new-link.ts'),
        );

        expect(
            guardBackendBaseToolCall(
                'write',
                { path: 'new-link.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toMatchObject({ block: true });
    });

    test('blocks shell calls that explicitly reference or run inside Base', () => {
        const projectRoot = createProject();
        const protectedRoot = path.join(
            projectRoot,
            'code/backend/src/base',
        );

        expect(
            guardBackendBaseToolCall(
                'bash',
                { command: 'touch code/backend/src/base/new.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toMatchObject({ block: true });
        expect(
            guardBackendBaseToolCall(
                'ShellSession',
                { command: 'touch new.ts' },
                protectedRoot,
                projectRoot,
            ),
        ).toMatchObject({ block: true });
        expect(
            guardBackendBaseToolCall(
                'ShellSession',
                { command: 'cd code/backend/src/base' },
                projectRoot,
                projectRoot,
            ),
        ).toMatchObject({ block: true });
    });

    test('allows reads and mutations outside backend Base', () => {
        const projectRoot = createProject();

        expect(
            guardBackendBaseToolCall(
                'read',
                { path: 'code/backend/src/base/interfaces.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toBeUndefined();
        expect(
            guardBackendBaseToolCall(
                'write',
                { path: 'code/backend/src/module/health/types.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toBeUndefined();
        expect(
            guardBackendBaseToolCall(
                'bash',
                { command: 'npm run verify' },
                projectRoot,
                projectRoot,
            ),
        ).toBeUndefined();
        expect(
            guardBackendBaseToolCall(
                'bash',
                { command: 'cat code/backend/src/base/interfaces.ts' },
                projectRoot,
                projectRoot,
            ),
        ).toBeUndefined();
    });
});
