import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const current = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: projectRoot,
    encoding: 'utf8',
});

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
