import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { RuntimeContract } from '../../../../script/runtime-check/runtime.contract.ts';

const roots: string[] = [];
const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
);

function write(root: string, relativePath: string, content: string): void {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-contract-'));
    roots.push(root);
    const engines = { node: '24.19.0', npm: '>=11 <12' };
    write(root, '.nvmrc', '24.19.0\n');
    write(root, '.npmrc', 'engine-strict=true\nignore-scripts=true\n');
    write(root, 'package.json', JSON.stringify({
        packageManager: 'npm@11.8.0',
        engines,
        devEngines: {
            runtime: {
                name: 'node',
                version: '24.19.0',
                onFail: 'error',
            },
            packageManager: {
                name: 'npm',
                version: '>=11 <12',
                onFail: 'error',
            },
        },
    }));
    for (const relativePath of [
        'code/backend/package.json',
        'code/frontend/web/package.json',
    ]) {
        write(root, relativePath, JSON.stringify({ engines }));
    }
    for (const relativePath of [
        'deployment/docker/backend.Dockerfile',
        'deployment/docker/frontend.Dockerfile',
    ]) {
        write(root, relativePath, 'FROM node:24.19.0-bookworm-slim\n');
    }
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('repository runtime contract uses the active canonical runtime', () => {
    expect(new RuntimeContract(projectRoot).check(
        process.versions.node,
        '11.8.0',
    )).toEqual({
        nodeVersion: '24.19.0',
        npmVersion: '11.8.0',
    });
});

test('runtime contract rejects a different Node version without installing it', () => {
    expect(() => new RuntimeContract(fixture()).check(
        '24.18.0',
        '11.8.0',
    )).toThrow(/Node\.js 24\.19\.0 is required/);
});

test('runtime contract rejects workspace and Docker version drift', () => {
    const workspaceRoot = fixture();
    write(workspaceRoot, 'code/backend/package.json', JSON.stringify({
        engines: { node: '22.23.1', npm: '>=11 <12' },
    }));
    expect(() => new RuntimeContract(workspaceRoot).check(
        '24.19.0',
        '11.8.0',
    )).toThrow(/code\/backend\/package\.json engines\.node/);

    const dockerRoot = fixture();
    write(
        dockerRoot,
        'deployment/docker/frontend.Dockerfile',
        'FROM node:22.23.1-bookworm-slim\n',
    );
    expect(() => new RuntimeContract(dockerRoot).check(
        '24.19.0',
        '11.8.0',
    )).toThrow(/frontend\.Dockerfile must start/);
});
