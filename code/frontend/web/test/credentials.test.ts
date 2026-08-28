import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { CredentialManager } from '../../../../script/credentials/credential.manager.ts';

const roots: string[] = [];

function fixture(git = false): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, '.gitignore'), '/.credentials.env\n');
    fs.writeFileSync(path.join(root, '.dockerignore'), '/.credentials.env\n');
    fs.writeFileSync(
        path.join(root, '.credentials.example.env'),
        'TEST_TEMPLATE_SECRET=\n',
    );
    if (git) {
        spawnSync('git', ['init', '--quiet'], { cwd: root });
    }
    return root;
}

afterEach(() => {
    delete process.env.TEST_TEMPLATE_SECRET;
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('credential initialization is private and never overwrites a file', () => {
    const root = fixture();
    const manager = new CredentialManager(root);

    manager.initialize();

    expect(fs.statSync(path.join(root, '.credentials.env')).mode & 0o777)
        .toBe(0o600);
    expect(() => manager.initialize()).toThrow(/Refusing to replace/);
});

test('credential initialization refuses symlinks', () => {
    const root = fixture();
    fs.symlinkSync('missing-target', path.join(root, '.credentials.env'));

    expect(() => new CredentialManager(root).initialize()).toThrow(/symlink/);
});

test('credential checks reject unsafe permissions and forced Git staging', () => {
    const root = fixture(true);
    const credentialPath = path.join(root, '.credentials.env');
    fs.writeFileSync(credentialPath, 'TEST_TEMPLATE_SECRET=local\n', {
        mode: 0o644,
    });
    const manager = new CredentialManager(root);

    expect(() => manager.check()).toThrow(/mode 0600/);
    fs.chmodSync(credentialPath, 0o600);
    spawnSync('git', ['add', '-f', '.credentials.env'], { cwd: root });
    expect(() => manager.check()).toThrow(/must not be tracked or staged/);
});

test('credential run gives an existing environment value precedence', () => {
    const root = fixture();
    fs.writeFileSync(
        path.join(root, '.credentials.env'),
        'TEST_TEMPLATE_SECRET=from-file\n',
        { mode: 0o600 },
    );
    fs.writeFileSync(path.join(root, 'capture.mjs'), [
        "import fs from 'node:fs';",
        "fs.writeFileSync('result.txt', process.env.TEST_TEMPLATE_SECRET === 'from-host' ? 'host' : 'other');",
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        scripts: { capture: 'node capture.mjs' },
    }));
    process.env.TEST_TEMPLATE_SECRET = 'from-host';

    expect(new CredentialManager(root).run('capture', [])).toBe(0);
    expect(fs.readFileSync(path.join(root, 'result.txt'), 'utf8')).toBe('host');
});

test('credential run accepts the documented optional argument separator', () => {
    const root = fixture();
    fs.writeFileSync(
        path.join(root, '.credentials.env'),
        'TEST_TEMPLATE_SECRET=local\n',
        { mode: 0o600 },
    );
    fs.writeFileSync(path.join(root, 'capture.mjs'), [
        "import fs from 'node:fs';",
        "fs.writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));",
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        scripts: { capture: 'node capture.mjs' },
    }));

    expect(new CredentialManager(root).run(
        'capture',
        ['--', 'local', 'all'],
    )).toBe(0);
    expect(JSON.parse(fs.readFileSync(
        path.join(root, 'arguments.json'),
        'utf8',
    ))).toEqual(['local', 'all']);
});

test('credential run redacts file and overridden values from child output', () => {
    const root = fixture();
    fs.writeFileSync(
        path.join(root, '.credentials.env'),
        'TEST_TEMPLATE_SECRET=from-file\n',
        { mode: 0o600 },
    );
    fs.writeFileSync(
        path.join(root, 'print.mjs'),
        "process.stdout.write(`value=${process.env.TEST_TEMPLATE_SECRET}\\n`);\n",
    );
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        scripts: { print: 'node print.mjs' },
    }));
    process.env.TEST_TEMPLATE_SECRET = 'from-host';
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
    }) as typeof process.stdout.write;
    try {
        expect(new CredentialManager(root).run('print', [])).toBe(0);
    } finally {
        process.stdout.write = originalWrite;
    }

    expect(writes.join('')).toContain('value=[REDACTED]');
    expect(writes.join('')).not.toContain('from-host');
    expect(writes.join('')).not.toContain('from-file');
});

test('repository credential example declares value-free sudo authentication', () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const lines = fs.readFileSync(
        path.join(projectRoot, '.credentials.example.env'),
        'utf8',
    ).split(/\r?\n/u);

    expect(lines).toContain('DEPLOYMENT_SUDO_PASSWORD=');
    expect(lines.some((line) =>
        line.startsWith('DEPLOYMENT_SUDO_PASSWORD=') &&
        line !== 'DEPLOYMENT_SUDO_PASSWORD=',
    )).toBe(false);
});
