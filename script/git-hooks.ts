import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Installs the versioned hook contract for one project checkout. */
export function configureGitHooks(projectRoot: string): void {
    const hook = path.join(projectRoot, '.githooks/pre-commit');
    const status = fs.lstatSync(hook);
    if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error(
            'Versioned pre-commit hook must be a regular non-symlink file.',
        );
    }
    fs.chmodSync(hook, 0o755);

    const current = spawnSync(
        'git',
        ['config', '--local', '--get', 'core.hooksPath'],
        {
            cwd: projectRoot,
            encoding: 'utf8',
        },
    );

    if (current.status === 0 && current.stdout.trim() !== '.githooks') {
        console.warn(
            `Keeping existing Git hooks path '${current.stdout.trim()}'; ` +
            'npm run verify still enforces credential safety.',
        );
    } else {
        const configured = spawnSync(
            'git',
            ['config', '--local', 'core.hooksPath', '.githooks'],
            { cwd: projectRoot, encoding: 'utf8' },
        );
        if (configured.status !== 0 && current.status === 0) {
            console.warn('Could not configure the versioned Git hook.');
        }
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    configureGitHooks(path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    ));
}
