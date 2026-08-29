import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
    configureGitHooks,
} from '../../../../script/git-hooks.ts';

const roots: string[] = [];

function projectWithHook(mode: number): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, '.githooks'));
    fs.writeFileSync(
        path.join(root, '.githooks/pre-commit'),
        '#!/bin/sh\nexit 0\n',
        { mode },
    );
    const initialized = spawnSync('git', ['init', '--quiet'], {
        cwd: root,
        encoding: 'utf8',
    });
    expect(initialized.status).toBe(0);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Git hook setup repairs execution mode and configures the checkout', () => {
    const root = projectWithHook(0o644);

    configureGitHooks(root);

    expect(fs.statSync(path.join(root, '.githooks/pre-commit')).mode & 0o777)
        .toBe(0o755);
    const configured = spawnSync(
        'git',
        ['config', '--local', '--get', 'core.hooksPath'],
        { cwd: root, encoding: 'utf8' },
    );
    expect(configured.status).toBe(0);
    expect(configured.stdout.trim()).toBe('.githooks');
});

test('Git hook setup rejects a linked hook before changing Git config', () => {
    const root = projectWithHook(0o755);
    const hook = path.join(root, '.githooks/pre-commit');
    fs.rmSync(hook);
    fs.symlinkSync('/dev/null', hook);

    expect(() => configureGitHooks(root)).toThrow(/non-symlink/);
    const configured = spawnSync(
        'git',
        ['config', '--local', '--get', 'core.hooksPath'],
        { cwd: root, encoding: 'utf8' },
    );
    expect(configured.status).not.toBe(0);
});
