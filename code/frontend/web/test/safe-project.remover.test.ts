import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { SafeProjectRemover } from '../../../../script/safe-remove/safe-project.remover.ts';

const roots: string[] = [];

/** Creates one isolated project root. */
function temporaryRoot(): string {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'safe-project-remove-'),
    );
    roots.push(root);
    return root;
}

/** Creates a fixture file and its parent directories. */
function write(root: string, relativePath: string): void {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'fixture');
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('removes explicit project files, directories, and symlinks', () => {
    const root = temporaryRoot();
    write(root, 'tmp/file.txt');
    write(root, 'target.txt');
    fs.symlinkSync(
        path.join(root, 'target.txt'),
        path.join(root, 'target-link'),
    );
    const remover = new SafeProjectRemover(root);

    remover.remove(['tmp', 'target-link']);

    expect(fs.existsSync(path.join(root, 'tmp'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'target-link'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'target.txt'))).toBe(true);
});

test('dry-run validates targets without removing them', () => {
    const root = temporaryRoot();
    write(root, 'tmp/file.txt');

    const targets = new SafeProjectRemover(root).remove(['tmp'], true);

    expect(targets[0]?.relativePath).toBe('tmp');
    expect(fs.existsSync(path.join(root, 'tmp/file.txt'))).toBe(true);
});

test('rejects root, traversal, absolute paths, globs, flags, and Git metadata', () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, '.git'));
    const remover = new SafeProjectRemover(root);
    for (const target of [
        '.',
        '../outside',
        path.join(root, 'inside'),
        '*.log',
        '--force',
        '.git',
    ]) {
        expect(() => remover.remove([target])).toThrow();
    }
});

test('validates all paths before performing any removal', () => {
    const root = temporaryRoot();
    write(root, 'keep.txt');
    const remover = new SafeProjectRemover(root);

    expect(() => remover.remove(['keep.txt', '../outside'])).toThrow();
    expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(true);
});

test('rejects duplicate and nested targets before removing anything', () => {
    const root = temporaryRoot();
    write(root, 'tmp/file.txt');
    const remover = new SafeProjectRemover(root);

    expect(() => remover.remove(['tmp', 'tmp/file.txt'])).toThrow(
        /must not overlap/,
    );
    expect(fs.existsSync(path.join(root, 'tmp/file.txt'))).toBe(true);
});

test('rejects traversal through a symbolic-link parent', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    write(outside, 'file.txt');
    fs.symlinkSync(outside, path.join(root, 'outside-link'));

    expect(() =>
        new SafeProjectRemover(root).remove(['outside-link/file.txt']),
    ).toThrow(/symbolic-link parent/);
    expect(fs.existsSync(path.join(outside, 'file.txt'))).toBe(true);
});

test('agent instructions document every root npm script', () => {
    const projectRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../..',
    );
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const agents = fs.readFileSync(
        path.join(projectRoot, 'AGENTS.md'),
        'utf8',
    );

    for (const script of Object.keys(packageJson.scripts)) {
        expect(agents).toContain(`npm run ${script}`);
    }
});

test('canonical agent instructions own the basis and delegate project rules', () => {
    const projectRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../..',
    );
    const agents = fs.readFileSync(
        path.join(projectRoot, 'AGENTS.md'),
        'utf8',
    );

    expect(fs.existsSync(
        path.join(projectRoot, 'AGENTS-DEFAULT.md'),
    )).toBe(false);
    expect(agents).toContain(
        'you must read `AGENTS-PROJECT.md` if it exists',
    );
    expect(agents).toContain(
        'overrides conflicting rules in this file regardless of wording strength',
    );
    expect(agents).toContain(
        '`AGENTS.md` is template-owned and replaced by every update',
    );
});
