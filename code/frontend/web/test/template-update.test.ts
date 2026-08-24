import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { ArchiveRepository } from '../../../../script/template-update/archive.repository.ts';
import { ConflictReporter } from '../../../../script/template-update/conflict.reporter.ts';
import { GitHubReleaseClient } from '../../../../script/template-update/github.release-client.ts';
import { SemanticVersion } from '../../../../script/template-update/semantic-version.ts';
import { TemplateMetadataRepository } from '../../../../script/template-update/template.metadata-repository.ts';
import { TemplateUpdater } from '../../../../script/template-update/template.updater.ts';
import { UpdatePlanner } from '../../../../script/template-update/update.planner.ts';
import { UpdateTransaction } from '../../../../script/template-update/update.transaction.ts';
import type { ProcessRunner } from '../../../../script/deployment/process.runner.ts';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(root);
    return root;
}

function write(root: string, relativePath: string, content: string): void {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function writeCanonicalInstructions(
    roots_: readonly string[],
    content = 'canonical agent instructions',
): void {
    for (const root of roots_) {
        write(root, 'AGENTS.md', content);
    }
}

function archive(root: string, name: string): Buffer {
    const archivePath = path.join(path.dirname(root), `${name}.tar.gz`);
    ProcessFixtureRunner.run('tar', [
        '-czf',
        archivePath,
        '-C',
        path.dirname(root),
        path.basename(root),
    ]);
    return fs.readFileSync(archivePath);
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('semantic versions accept stable tags and compare deterministically', () => {
    expect(new SemanticVersion('v1.2.3').value).toBe('1.2.3');
    expect(
        new SemanticVersion('2.0.0').compare(new SemanticVersion('1.9.9')),
    ).toBe(1);
    expect(
        new SemanticVersion('1.0.0').compare(new SemanticVersion('1.0.0')),
    ).toBe(0);
    expect(() => new SemanticVersion('1.0.0-beta.1')).toThrow(/Invalid stable/);
});

test('metadata requires explicit initialization for legacy projects', () => {
    const project = temporaryRoot('template-metadata-');
    write(project, 'package.json', JSON.stringify({
        version: '1.4.0',
    }));

    expect(() => new TemplateMetadataRepository().load(project)).toThrow(
        /template:init/,
    );
});

test('metadata loads only the dedicated template version file', () => {
    const project = temporaryRoot('template-metadata-');
    write(project, '.template/version.json', JSON.stringify({
        version: '1.4.0',
        repository: 'ghtkuhn/web-app-template',
    }));

    expect(new TemplateMetadataRepository().load(project)).toEqual({
        version: '1.4.0',
        repository: 'ghtkuhn/web-app-template',
    });
});

test('legacy initialization validates a release without changing app version', async () => {
    const project = temporaryRoot('template-init-');
    write(project, 'package.json', JSON.stringify({
        name: 'my-app',
        version: '8.7.6',
    }));
    const requested: string[] = [];
    const runner = {
        run(): string {
            return '';
        },
    } as ProcessRunner;
    const updater = new TemplateUpdater(runner, () => ({
        async resolve(version?: string) {
            requested.push(version as string);
            return {
                version: version as string,
                tag: `v${version}`,
                archiveUrl: version as string,
            };
        },
        async download() {
            throw new Error('not used');
        },
    }));

    await updater.initialize(project, '1.2.3');

    expect(requested).toEqual(['1.2.3']);
    expect(JSON.parse(fs.readFileSync(
        path.join(project, '.template/version.json'),
        'utf8',
    ))).toMatchObject({ version: '1.2.3' });
    expect(JSON.parse(fs.readFileSync(
        path.join(project, 'package.json'),
        'utf8',
    ))).toMatchObject({ version: '8.7.6' });
    await expect(updater.initialize(project, '1.2.3')).rejects.toMatchObject({
        exitCode: 1,
    });
});

test('template updater CLI documents usage and stable input exit codes', () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const entry = path.join(projectRoot, 'script/template-update.ts');
    const help = spawnSync(process.execPath, [entry, 'update', '--help'], {
        cwd: projectRoot,
        encoding: 'utf8',
    });
    const invalid = spawnSync(process.execPath, [entry, 'unknown'], {
        cwd: projectRoot,
        encoding: 'utf8',
    });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain('npm run template:update');
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Unknown template command 'unknown'");
});

test('GitHub release resolution rejects prereleases and builds source URLs', async () => {
    const requests: string[] = [];
    const client = new GitHubReleaseClient(
        'ghtkuhn/web-app-template',
        async (input) => {
            requests.push(String(input));
            return new Response(JSON.stringify({
                tag_name: 'v1.2.0',
                draft: false,
                prerelease: false,
            }));
        },
        {},
    );

    const release = await client.resolve('1.2.0');

    expect(release.version).toBe('1.2.0');
    expect(release.archiveUrl).toContain('/refs/tags/v1.2.0.tar.gz');
    expect(requests[0]).toContain('/releases/tags/v1.2.0');
});

test('three-way planning updates safe files and reports real conflicts', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'unchanged.txt', 'old');
    write(local, 'unchanged.txt', 'old');
    write(incoming, 'unchanged.txt', 'new');
    write(base, 'local-only.txt', 'base');
    write(local, 'local-only.txt', 'local');
    write(incoming, 'local-only.txt', 'base');
    write(base, 'conflict.txt', 'base');
    write(local, 'conflict.txt', 'local');
    write(incoming, 'conflict.txt', 'incoming');
    write(local, 'custom.txt', 'custom');
    write(incoming, 'added.txt', 'added');
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions.map((action) => [
        action.kind,
        action.relativePath,
    ])).toEqual([
        ['write', 'added.txt'],
        ['write', 'unchanged.txt'],
    ]);
    expect(plan.conflicts.map((conflict) => conflict.relativePath)).toEqual([
        'conflict.txt',
    ]);
    expect(fs.readFileSync(path.join(local, 'custom.txt'), 'utf8')).toBe(
        'custom',
    );
});

test('planner restores the target gitignore when it is locally missing', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, '.gitignore', 'node_modules/\n');
    write(incoming, '.gitignore', 'node_modules/\n.credentials.env\n');
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const action = plan.actions.find(
        (candidate) => candidate.relativePath === '.gitignore',
    );

    expect(action?.kind).toBe('write');
    expect(action?.kind === 'write' && fs.readFileSync(
        action.sourcePath,
        'utf8',
    )).toBe('node_modules/\n.credentials.env\n');
    expect(plan.conflicts).toEqual([]);
});

test('planner preserves an existing locally changed gitignore', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, '.gitignore', 'node_modules/\n');
    write(local, '.gitignore', 'node_modules/\nlocal-output/\n');
    write(incoming, '.gitignore', 'node_modules/\n');
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions.some(
        (action) => action.relativePath === '.gitignore',
    )).toBe(false);
    expect(plan.conflicts).toEqual([]);
});

test('planner handles safe deletion and conflicts on modified deletion', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'delete.txt', 'old');
    write(local, 'delete.txt', 'old');
    write(base, 'keep.txt', 'old');
    write(local, 'keep.txt', 'custom');
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions).toContainEqual({
        kind: 'delete',
        relativePath: 'delete.txt',
    });
    expect(plan.conflicts[0]?.relativePath).toBe('keep.txt');
});

test('agent instructions replace the basis and preserve project rules', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'AGENTS.md', 'old template basis');
    write(base, 'AGENTS-DEFAULT.md', 'old defaults');
    write(local, 'AGENTS.md', 'locally changed basis');
    write(local, 'AGENTS-DEFAULT.md', 'locally changed defaults');
    write(local, 'AGENTS-PROJECT.md', 'project-specific rules');
    write(incoming, 'AGENTS.md', 'new canonical basis');
    write(incoming, 'AGENTS-DEFAULT.md', 'must not be installed');
    write(incoming, 'AGENTS-PROJECT.md', 'must not be installed');

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions.map((action) => [
        action.kind,
        action.relativePath,
    ])).toEqual([
        ['delete', 'AGENTS-DEFAULT.md'],
        ['write', 'AGENTS.md'],
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(fs.readFileSync(
        path.join(local, 'AGENTS-PROJECT.md'),
        'utf8',
    )).toBe('project-specific rules');
});

test('agent instruction planning rejects missing and unsafe basis files', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');

    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /regular AGENTS\.md/,
    );

    write(incoming, 'AGENTS.md', 'canonical basis');
    fs.symlinkSync('missing.md', path.join(local, 'AGENTS.md'));
    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /Local AGENTS\.md must be a regular file/,
    );
});

test('repository ships canonical Boolean project configuration', () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const configuration = JSON.parse(fs.readFileSync(
        path.join(projectRoot, 'project.json'),
        'utf8',
    )) as { 'template-config': { 'use-kanban': unknown } };
    const ignoreRules = fs.readFileSync(
        path.join(projectRoot, '.gitignore'),
        'utf8',
    ).split(/\r?\n/u);

    expect(configuration['template-config']['use-kanban']).toBe(true);
    expect(ignoreRules).not.toContain('project.json');
});

test('project configuration preserves local state and adds only new defaults', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    writeCanonicalInstructions([base, local, incoming]);
    write(base, 'project.json', JSON.stringify({
        'template-config': {
            'use-kanban': true,
            options: {
                existing: 'base',
                deletedLocally: 'base',
            },
            removedByTemplate: 'base',
        },
    }));
    write(local, 'project.json', JSON.stringify({
        'template-config': {
            'use-kanban': 'true',
            options: {
                existing: 'local',
            },
            removedByTemplate: 'local',
            localOnly: ['keep', 'all'],
        },
    }));
    fs.chmodSync(path.join(local, 'project.json'), 0o640);
    write(incoming, 'project.json', JSON.stringify({
        'template-config': {
            'use-kanban': false,
            options: {
                existing: 'incoming',
                deletedLocally: 'incoming',
                added: 'new-default',
            },
            futureSetting: true,
        },
    }));

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const action = plan.actions.find(
        (candidate) => candidate.relativePath === 'project.json',
    );
    expect(action?.kind).toBe('write');
    expect(action?.kind === 'write' && action.mode).toBe(0o640);
    const sourcePath = action?.kind === 'write' ? action.sourcePath : '';
    const source = fs.readFileSync(sourcePath, 'utf8');
    const merged = JSON.parse(source) as Record<string, unknown>;

    expect(merged).toEqual({
        'template-config': {
            futureSetting: true,
            localOnly: ['keep', 'all'],
            options: {
                added: 'new-default',
                existing: 'local',
            },
            removedByTemplate: 'local',
            'use-kanban': 'true',
        },
    });
    expect(source).toContain('\n    "template-config"');
    expect(source.endsWith('\n')).toBe(true);
    expect(plan.conflicts).toEqual([]);
});

test('project configuration merges legacy apps without a template base', () => {
    const base = temporaryRoot('template-legacy-base-');
    const local = temporaryRoot('template-legacy-local-');
    const incoming = temporaryRoot('template-legacy-incoming-');
    writeCanonicalInstructions([base, local, incoming]);
    write(local, 'project.json', JSON.stringify({
        'template-config': {
            'use-kanban': 'true',
            localSetting: 'keep',
        },
    }));
    write(incoming, 'project.json', JSON.stringify({
        'template-config': {
            'use-kanban': true,
            futureSetting: 'add',
        },
        futureRoot: true,
    }));

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const action = plan.actions.find(
        (candidate) => candidate.relativePath === 'project.json',
    );
    const merged = JSON.parse(fs.readFileSync(
        action?.kind === 'write' ? action.sourcePath : '',
        'utf8',
    )) as Record<string, unknown>;

    expect(merged).toEqual({
        futureRoot: true,
        'template-config': {
            futureSetting: 'add',
            localSetting: 'keep',
            'use-kanban': 'true',
        },
    });
});

test('project configuration installs the incoming file when local is missing', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    writeCanonicalInstructions([base, local, incoming]);
    write(incoming, 'project.json', JSON.stringify({
        'template-config': { 'use-kanban': true },
    }));

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions).toContainEqual({
        kind: 'write',
        relativePath: 'project.json',
        sourcePath: path.join(incoming, 'project.json'),
        mode: fs.statSync(path.join(incoming, 'project.json')).mode & 0o777,
    });
});

test('project configuration rejects invalid objects and symlinks read-only', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    writeCanonicalInstructions([base, local, incoming]);
    write(incoming, 'project.json', '{"future":true}');
    write(local, 'project.json', '{invalid');

    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /Local project\.json must contain valid JSON/,
    );
    expect(fs.readFileSync(path.join(local, 'project.json'), 'utf8'))
        .toBe('{invalid');

    write(local, 'project.json', '[]');
    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /Local project\.json must contain a JSON object/,
    );

    fs.unlinkSync(path.join(local, 'project.json'));
    fs.symlinkSync('missing-project.json', path.join(local, 'project.json'));
    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /Local project\.json must be a regular non-symlink file/,
    );
});

test('planner excludes local secrets, runtime data, and agent state', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    for (const relativePath of [
        '.env',
        '.credentials.env',
        'deployment/profiles/production.json',
        'deployment/profiles/work.local.json',
        'deployment/secrets/token.txt',
        'data/ai/MEMORY.md',
        'data/ai/kanban/done/task.md',
        'data/sqlite/backend.sqlite',
    ]) {
        write(base, relativePath, 'old');
        write(local, relativePath, 'local');
        write(incoming, relativePath, 'incoming');
    }
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
});

test('major update preserves application state and keeps opt-ins disabled', () => {
    const base = temporaryRoot('template-2-base-');
    const local = temporaryRoot('template-2-app-');
    const incoming = temporaryRoot('template-3-incoming-');
    for (const relativePath of [
        'code/backend/src/module/billing/index.ts',
        'deployment/profiles/production.json',
        'data/ai/MEMORY.md',
        'data/ai/kanban/todo/0001-billing-create-invoice.md',
        '.credentials.env',
    ]) {
        write(local, relativePath, `local:${relativePath}`);
    }
    write(base, 'managed.txt', '2.x');
    write(local, 'managed.txt', '2.x');
    write(incoming, 'managed.txt', '3.x');
    write(
        incoming,
        'code/backend/script/store-migration-status.ts',
        'store diagnostics',
    );
    write(
        incoming,
        'code/backend/script/migration-check.ts',
        'migration diagnostics',
    );
    write(
        incoming,
        'code/frontend/web/script/pwa-scaffold.ts',
        'opt-in PWA scaffold',
    );
    write(
        incoming,
        'script/deployment/existing-lxc.driver.ts',
        'opt-in existing LXC driver',
    );
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const paths = plan.actions.map((action) => action.relativePath);

    expect(plan.conflicts).toEqual([]);
    expect(paths).toEqual(expect.arrayContaining([
        'code/backend/script/migration-check.ts',
        'code/backend/script/store-migration-status.ts',
        'code/frontend/web/script/pwa-scaffold.ts',
        'managed.txt',
        'script/deployment/existing-lxc.driver.ts',
    ]));
    expect(paths).not.toContain('code/backend/src/module/billing/index.ts');
    expect(paths).not.toContain('deployment/profiles/production.json');
    expect(paths).not.toContain('data/ai/MEMORY.md');
    expect(paths).not.toContain(
        'data/ai/kanban/todo/0001-billing-create-invoice.md',
    );
    expect(paths).not.toContain('.credentials.env');
    expect(paths).not.toContain('code/frontend/web/.pwa-scaffold.json');
    expect(paths).not.toContain('code/frontend/web/src/app/sw.ts');
});

test('package planning preserves app identity and merges template properties', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'package.json', JSON.stringify({
        name: 'template',
        version: '1.0.0',
        scripts: {
            verify: 'old',
            local: 'base',
        },
        dependencies: {
            old: '1.0.0',
        },
    }));
    write(local, 'package.json', JSON.stringify({
        name: 'my-app',
        version: '7.4.2',
        repository: 'local/repository',
        scripts: {
            verify: 'old',
            local: 'custom',
        },
        dependencies: {
            old: '1.0.0',
        },
    }));
    write(incoming, 'package.json', JSON.stringify({
        name: 'template-renamed',
        version: '2.0.0',
        scripts: {
            verify: 'new',
            local: 'base',
        },
        dependencies: {
            old: '1.0.0',
            added: '2.0.0',
        },
    }));
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const packageAction = plan.actions.find(
        (action) => action.relativePath === 'package.json',
    );
    expect(packageAction?.kind).toBe('write');
    const merged = JSON.parse(fs.readFileSync(
        (packageAction as { sourcePath: string }).sourcePath,
        'utf8',
    )) as Record<string, unknown>;

    expect(merged.name).toBe('my-app');
    expect(merged.version).toBe('7.4.2');
    expect(merged.repository).toBe('local/repository');
    expect(merged.scripts).toEqual({
        local: 'custom',
        verify: 'new',
    });
    expect(merged.dependencies).toEqual({
        added: '2.0.0',
        old: '1.0.0',
    });
    expect(plan.conflicts).toEqual([]);
});

test('package planning migrates a legacy application to the template runtime', () => {
    const base = temporaryRoot('template-2-base-');
    const local = temporaryRoot('template-2-app-');
    const incoming = temporaryRoot('template-3-incoming-');
    const legacy = {
        name: 'template',
        version: '2.9.0',
        engines: { node: '22.23.1' },
    };
    write(base, 'package.json', JSON.stringify(legacy));
    write(local, 'package.json', JSON.stringify({
        ...legacy,
        name: 'customer-app',
        version: '8.1.0',
    }));
    write(incoming, 'package.json', JSON.stringify({
        ...legacy,
        version: '3.0.0',
        packageManager: 'npm@11.17.0',
        engines: { node: '24.19.0', npm: '>=11 <12' },
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
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const packageAction = plan.actions.find(
        (action) => action.relativePath === 'package.json',
    );
    const merged = JSON.parse(fs.readFileSync(
        (packageAction as { sourcePath: string }).sourcePath,
        'utf8',
    )) as Record<string, unknown>;

    expect(plan.conflicts).toEqual([]);
    expect(merged).toMatchObject({
        name: 'customer-app',
        version: '8.1.0',
        packageManager: 'npm@11.17.0',
        engines: { node: '24.19.0', npm: '>=11 <12' },
        devEngines: {
            runtime: { name: 'node', version: '24.19.0', onFail: 'error' },
            packageManager: { name: 'npm', version: '>=11 <12', onFail: 'error' },
        },
    });
});

test('package planning merges workspace manifests and enforces target runtime', () => {
    const base = temporaryRoot('template-workspace-base-');
    const local = temporaryRoot('template-workspace-local-');
    const incoming = temporaryRoot('template-workspace-incoming-');
    for (const relativePath of [
        'code/backend/package.json',
        'code/frontend/web/package.json',
    ]) {
        write(base, relativePath, JSON.stringify({
            name: relativePath.includes('backend') ? '@app/backend' : '@app/web',
            engines: { node: '>=22.23.1 <23' },
            scripts: { test: 'old' },
            dependencies: { shared: '1.0.0' },
            devDependencies: { '@types/node': '^22.20.1' },
        }));
        write(local, relativePath, JSON.stringify({
            name: relativePath.includes('backend')
                ? '@customer/backend'
                : '@customer/web',
            engines: { node: '>=20' },
            scripts: { test: 'old', custom: 'local-command' },
            dependencies: { shared: '1.0.0', local: '7.0.0' },
            devDependencies: { '@types/node': '^22.20.1' },
        }));
        write(incoming, relativePath, JSON.stringify({
            name: relativePath.includes('backend') ? '@app/backend' : '@app/web',
            engines: { node: '24.19.0', npm: '>=11 <12' },
            scripts: { test: 'new' },
            dependencies: { shared: '1.0.0' },
            devDependencies: { '@types/node': '^24.13.3' },
        }));
    }
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.conflicts).toEqual([]);
    for (const relativePath of [
        'code/backend/package.json',
        'code/frontend/web/package.json',
    ]) {
        const action = plan.actions.find(
            (candidate) => candidate.relativePath === relativePath,
        );
        expect(action?.kind).toBe('write');
        const merged = JSON.parse(fs.readFileSync(
            (action as { sourcePath: string }).sourcePath,
            'utf8',
        ));
        expect(merged.engines).toEqual({
            node: '24.19.0',
            npm: '>=11 <12',
        });
        expect(merged.name).toContain('@customer/');
        expect(merged.scripts).toEqual({
            custom: 'local-command',
            test: 'new',
        });
        expect(merged.dependencies.local).toBe('7.0.0');
        expect(merged.devDependencies['@types/node']).toBe('^24.13.3');
    }
});

test('package planning replaces an unchanged Pico contract with Bootstrap', () => {
    const base = temporaryRoot('template-pico-base-');
    const local = temporaryRoot('template-pico-local-');
    const incoming = temporaryRoot('template-bootstrap-incoming-');
    const relativePath = 'code/frontend/web/package.json';
    const picoManifest = {
        name: '@app/web',
        dependencies: {
            '@picocss/pico': '^2.1.1',
            vue: '^3.5.40',
        },
        devDependencies: {
            postcss: '^8.5.26',
        },
    };
    write(base, relativePath, JSON.stringify(picoManifest));
    write(local, relativePath, JSON.stringify(picoManifest));
    write(incoming, relativePath, JSON.stringify({
        name: '@app/web',
        dependencies: {
            '@popperjs/core': '^2.11.8',
            bootstrap: '^5.3.8',
            vue: '^3.5.40',
        },
        devDependencies: {
            postcss: '^8.5.26',
            'postcss-scss': '^4.0.9',
            sass: '^1.103.1',
        },
    }));
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);
    const action = plan.actions.find(
        (candidate) => candidate.relativePath === relativePath,
    );
    const merged = JSON.parse(fs.readFileSync(
        (action as { sourcePath: string }).sourcePath,
        'utf8',
    ));

    expect(plan.conflicts).toEqual([]);
    expect(merged.dependencies).toEqual({
        '@popperjs/core': '^2.11.8',
        bootstrap: '^5.3.8',
        vue: '^3.5.40',
    });
    expect(merged.devDependencies).toEqual({
        postcss: '^8.5.26',
        'postcss-scss': '^4.0.9',
        sass: '^1.103.1',
    });
});

test('package planning rejects a symlinked workspace manifest', () => {
    const base = temporaryRoot('template-workspace-base-');
    const local = temporaryRoot('template-workspace-local-');
    const incoming = temporaryRoot('template-workspace-incoming-');
    const manifest = JSON.stringify({ engines: { node: '24.19.0' } });
    write(base, 'code/backend/package.json', manifest);
    write(incoming, 'code/backend/package.json', manifest);
    write(local, 'backend-manifest.json', manifest);
    fs.mkdirSync(path.join(local, 'code/backend'), { recursive: true });
    fs.symlinkSync(
        path.join(local, 'backend-manifest.json'),
        path.join(local, 'code/backend/package.json'),
    );
    writeCanonicalInstructions([base, local, incoming]);

    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /regular file, not a symlink/u,
    );
});

test('package planning reports invalid workspace JSON before creating actions', () => {
    const base = temporaryRoot('template-workspace-base-');
    const local = temporaryRoot('template-workspace-local-');
    const incoming = temporaryRoot('template-workspace-incoming-');
    const manifest = JSON.stringify({ engines: { node: '24.19.0' } });
    write(base, 'code/frontend/web/package.json', manifest);
    write(incoming, 'code/frontend/web/package.json', manifest);
    write(local, 'code/frontend/web/package.json', '{invalid');
    writeCanonicalInstructions([base, local, incoming]);

    expect(() => new UpdatePlanner().plan(base, local, incoming)).toThrow(
        /code\/frontend\/web\/package\.json must contain valid JSON/u,
    );
});

test('package planning reports property-level concurrent changes', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'package.json', JSON.stringify({
        scripts: { verify: 'old' },
    }));
    write(local, 'package.json', JSON.stringify({
        scripts: { verify: 'local' },
    }));
    write(incoming, 'package.json', JSON.stringify({
        scripts: { verify: 'incoming' },
    }));
    writeCanonicalInstructions([base, local, incoming]);

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.relativePath).toBe('package.json');
    expect(plan.conflicts[0]?.reason).toContain('/scripts/verify');
});

test('conflict reports contain metadata and three-way variants', () => {
    const project = temporaryRoot('template-project-');
    const base = path.join(project, 'base.txt');
    const local = path.join(project, 'local.txt');
    const incoming = path.join(project, 'incoming.txt');
    fs.writeFileSync(base, 'base');
    fs.writeFileSync(local, 'local');
    fs.writeFileSync(incoming, 'incoming');

    const report = new ConflictReporter().write(project, {
        version: '1.0.0',
        repository: 'ghtkuhn/web-app-template',
    }, '2.0.0', [{
        relativePath: 'src/file.ts',
        reason: 'both changed',
        basePath: base,
        localPath: local,
        incomingPath: incoming,
    }]);

    expect(JSON.parse(
        fs.readFileSync(path.join(report, 'conflicts.json'), 'utf8'),
    )).toEqual([{
        id: 'src/file.ts',
        path: 'src/file.ts',
        reason: 'both changed',
    }]);
    expect(
        fs.readFileSync(path.join(report, 'incoming/src/file.ts'), 'utf8'),
    ).toBe('incoming');
});

test('conflict sessions require exact decisions and reject stale variants', () => {
    const project = temporaryRoot('template-project-');
    const base = path.join(project, 'base.txt');
    const local = path.join(project, 'local.txt');
    const incoming = path.join(project, 'incoming.txt');
    fs.writeFileSync(base, 'base');
    fs.writeFileSync(local, 'local');
    fs.writeFileSync(incoming, 'incoming');
    const reporter = new ConflictReporter();
    const conflicts = [{
        relativePath: 'src/file.ts',
        reason: 'both changed',
        basePath: base,
        localPath: local,
        incomingPath: incoming,
    }];
    const report = reporter.write(project, {
        version: '1.0.0',
        repository: 'ghtkuhn/web-app-template',
    }, '2.0.0', conflicts);
    const session = reporter.load(project, '2.0.0');

    expect(() => reporter.resolutions(project, session)).toThrow(
        /not resolved/,
    );
    write(report, 'resolutions.json', JSON.stringify({
        'src/file.ts': 'incoming',
        unknown: 'local',
    }));
    expect(() => reporter.resolutions(project, session)).toThrow(
        /do not match/,
    );
    fs.writeFileSync(local, 'changed after staging');
    expect(() => reporter.assertCurrent(session, conflicts)).toThrow(/stale/);
});

test('aborting a conflict session removes only ignored staging state', () => {
    const project = temporaryRoot('template-project-');
    const local = path.join(project, 'local.txt');
    fs.writeFileSync(local, 'project content');
    const reporter = new ConflictReporter();
    reporter.write(project, {
        version: '1.0.0',
        repository: 'ghtkuhn/web-app-template',
    }, '2.0.0', [{
        relativePath: 'local.txt',
        reason: 'conflict',
        localPath: local,
    }]);

    reporter.remove(project, '2.0.0');

    expect(fs.readFileSync(local, 'utf8')).toBe('project content');
    expect(reporter.pending(project)).toEqual([]);
});

test('transaction keeps installed files when verification fails', () => {
    const project = temporaryRoot('template-project-');
    const incoming = temporaryRoot('template-incoming-');
    write(project, 'existing.txt', 'old');
    write(incoming, 'existing.txt', 'new');
    write(incoming, 'added.txt', 'added');
    let verificationRuns = 0;
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            if (command === 'npm' && arguments_[0] === 'run') {
                verificationRuns += 1;
                throw new Error('verification failed');
            }
            return '';
        },
    } as ProcessRunner;

    const result = new UpdateTransaction(runner).execute(project, [
        {
            kind: 'write',
            relativePath: 'existing.txt',
            sourcePath: path.join(incoming, 'existing.txt'),
            mode: 0o644,
        },
        {
            kind: 'write',
            relativePath: 'added.txt',
            sourcePath: path.join(incoming, 'added.txt'),
            mode: 0o644,
        },
    ], '2.0.0');
    expect(verificationRuns).toBe(1);
    expect(result.verificationPassed).toBe(false);
    expect(fs.readFileSync(path.join(project, 'existing.txt'), 'utf8')).toBe(
        'new',
    );
    expect(fs.existsSync(path.join(project, 'added.txt'))).toBe(true);
});

test('transaction restores files, metadata, and lockfile after install failure', () => {
    const project = temporaryRoot('template-project-');
    const incoming = temporaryRoot('template-incoming-');
    write(project, 'existing.txt', 'old');
    write(project, 'AGENTS.md', 'old agent basis');
    write(project, 'AGENTS-DEFAULT.md', 'old default basis');
    write(project, '.template/version.json', '{"version":"1.0.0"}');
    write(project, 'package-lock.json', 'old-lock');
    write(incoming, 'existing.txt', 'new');
    write(incoming, 'AGENTS.md', 'new canonical basis');
    write(incoming, 'added.txt', 'added');
    write(incoming, 'version.json', '{"version":"2.0.0"}');
    let installs = 0;
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            if (command === 'npm' && arguments_[0] === 'install') {
                installs += 1;
                if (installs === 1) {
                    write(project, 'package-lock.json', 'broken-lock');
                    throw new Error('install failed');
                }
            }
            return '';
        },
    } as ProcessRunner;

    expect(() => new UpdateTransaction(runner).execute(project, [
        {
            kind: 'write',
            relativePath: 'existing.txt',
            sourcePath: path.join(incoming, 'existing.txt'),
            mode: 0o644,
        },
        {
            kind: 'write',
            relativePath: 'AGENTS.md',
            sourcePath: path.join(incoming, 'AGENTS.md'),
            mode: 0o644,
        },
        {
            kind: 'delete',
            relativePath: 'AGENTS-DEFAULT.md',
        },
        {
            kind: 'write',
            relativePath: 'added.txt',
            sourcePath: path.join(incoming, 'added.txt'),
            mode: 0o644,
        },
        {
            kind: 'write',
            relativePath: '.template/version.json',
            sourcePath: path.join(incoming, 'version.json'),
            mode: 0o644,
        },
    ], '2.0.0')).toThrow(/rolled back/);
    expect(installs).toBe(2);
    expect(fs.readFileSync(path.join(project, 'existing.txt'), 'utf8')).toBe(
        'old',
    );
    expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe(
        'old agent basis',
    );
    expect(fs.readFileSync(
        path.join(project, 'AGENTS-DEFAULT.md'),
        'utf8',
    )).toBe('old default basis');
    expect(fs.existsSync(path.join(project, 'added.txt'))).toBe(false);
    expect(fs.readFileSync(
        path.join(project, '.template/version.json'),
        'utf8',
    )).toBe('{"version":"1.0.0"}');
    expect(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'))
        .toBe('old-lock');
});

test('transaction rejects workspace runtime drift before target npm install', () => {
    const project = temporaryRoot('template-runtime-project-');
    const incoming = temporaryRoot('template-runtime-incoming-');
    const repositoryRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    for (const relativePath of [
        '.nvmrc',
        '.npmrc',
        'package.json',
        'code/backend/package.json',
        'code/frontend/web/package.json',
        'deployment/docker/backend.Dockerfile',
        'deployment/docker/frontend.Dockerfile',
        'deployment/lxc/runtime-contract.catalog.json',
        'deployment/lxc/bootstrap-existing-lxc.sh',
        'deployment/lxc/install-backend.sh',
        'deployment/lxc/install-frontend.sh',
        'script/deployment/lxc-runtime.contract.ts',
        'script/deployment/release.builder.ts',
        'script/deployment/ssh.release-driver.ts',
    ]) {
        write(
            project,
            relativePath,
            fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
        );
    }
    const backend = JSON.parse(fs.readFileSync(
        path.join(project, 'code/backend/package.json'),
        'utf8',
    ));
    backend.engines.node = '>=22.23.1 <23';
    write(
        incoming,
        'code/backend/package.json',
        `${JSON.stringify(backend, null, 4)}\n`,
    );
    let installs = 0;
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            if (command === 'npm' && arguments_[0] === 'install') {
                installs += 1;
            }
            return '';
        },
    } as ProcessRunner;

    expect(() => new UpdateTransaction(runner).execute(project, [{
        kind: 'write',
        relativePath: 'code/backend/package.json',
        sourcePath: path.join(incoming, 'code/backend/package.json'),
        mode: 0o644,
    }], '4.0.1')).toThrow(/runtime contract is inconsistent/u);
    expect(installs).toBe(1);
    expect(JSON.parse(fs.readFileSync(
        path.join(project, 'code/backend/package.json'),
        'utf8',
    )).engines.node).toBe('24.19.0');
});

test('transaction rejects a mixed legacy and incoming LXC runtime layout', () => {
    const project = temporaryRoot('template-lxc-project-');
    const incoming = temporaryRoot('template-lxc-incoming-');
    const repositoryRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    for (const relativePath of [
        '.nvmrc',
        '.npmrc',
        'package.json',
        'code/backend/package.json',
        'code/frontend/web/package.json',
        'deployment/docker/backend.Dockerfile',
        'deployment/docker/frontend.Dockerfile',
        'deployment/lxc/runtime-contract.catalog.json',
        'deployment/lxc/bootstrap-existing-lxc.sh',
        'deployment/lxc/install-backend.sh',
        'deployment/lxc/install-frontend.sh',
        'script/deployment/lxc-runtime.contract.ts',
        'script/deployment/release.builder.ts',
        'script/deployment/ssh.release-driver.ts',
    ]) {
        write(
            project,
            relativePath,
            fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
        );
    }
    const releaseBuilder = fs.readFileSync(
        path.join(repositoryRoot, 'script/deployment/release.builder.ts'),
        'utf8',
    );
    write(
        incoming,
        'script/deployment/release.builder.ts',
        `${releaseBuilder}\n// locally retained legacy release layout\n`,
    );
    let installs = 0;
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            if (command === 'npm' && arguments_[0] === 'install') {
                installs += 1;
            }
            return '';
        },
    } as ProcessRunner;

    expect(() => new UpdateTransaction(runner).execute(project, [{
        kind: 'write',
        relativePath: 'script/deployment/release.builder.ts',
        sourcePath: path.join(
            incoming,
            'script/deployment/release.builder.ts',
        ),
        mode: 0o644,
    }], '4.0.1')).toThrow(/LXC runtime contract drift/u);
    expect(installs).toBe(1);
    expect(fs.readFileSync(
        path.join(project, 'script/deployment/release.builder.ts'),
        'utf8',
    )).toBe(releaseBuilder);
});

test('updater continues all resolution types and keeps a failed verify update', async () => {
    const fixture = temporaryRoot('template-updater-');
    const base = path.join(fixture, 'repository-1.0.0');
    const incoming = path.join(fixture, 'repository-1.1.0');
    const project = path.join(fixture, 'project');
    fs.mkdirSync(base);
    fs.mkdirSync(incoming);
    fs.mkdirSync(project);
    const packageBase = {
        name: 'template',
        version: '1.0.0',
        scripts: { verify: 'old' },
    };
    write(base, 'package.json', JSON.stringify(packageBase));
    write(incoming, 'package.json', JSON.stringify({
        ...packageBase,
        version: '1.1.0',
        scripts: { verify: 'new' },
    }));
    write(project, 'package.json', JSON.stringify({
        ...packageBase,
        name: 'spendwise-like-app',
        version: '9.0.0',
    }));
    write(base, 'AGENTS.md', 'legacy template basis');
    write(base, 'AGENTS-DEFAULT.md', 'legacy defaults');
    write(project, 'AGENTS.md', 'locally changed basis');
    write(project, 'AGENTS-DEFAULT.md', 'locally changed defaults');
    write(project, 'AGENTS-PROJECT.md', 'project rules');
    write(incoming, 'AGENTS.md', 'new canonical basis');
    for (const file of ['local.txt', 'incoming.txt', 'merged.txt']) {
        write(base, file, 'base');
        write(project, file, 'local');
        write(incoming, file, 'incoming');
    }
    write(base, 'delete.txt', 'base');
    write(project, 'delete.txt', 'local');
    write(incoming, 'added-linter.ts', 'export const rule = true;\n');
    write(project, '.template/version.json', JSON.stringify({
        version: '1.0.0',
        repository: 'ghtkuhn/web-app-template',
    }));
    const releases = new Map([
        ['1.0.0', archive(base, 'base')],
        ['1.1.0', archive(incoming, 'incoming')],
    ]);
    const runner = {
        run(command: string, arguments_: readonly string[], options?: {
            readonly cwd?: string;
        }): string {
            if (command === 'git') {
                return '';
            }
            if (command === 'npm' && arguments_[0] === 'install') {
                write(options?.cwd as string, 'package-lock.json', 'generated');
                return '';
            }
            if (command === 'npm' && arguments_[0] === 'run') {
                throw new Error('verify found migration work');
            }
            return '';
        },
    } as ProcessRunner;
    const updater = new TemplateUpdater(runner, () => ({
        async resolve(version?: string) {
            const resolved = version ?? '1.1.0';
            return {
                version: resolved,
                tag: `v${resolved}`,
                archiveUrl: resolved,
            };
        },
        async download(release) {
            return releases.get(release.version) as Buffer;
        },
    }));

    await expect(updater.update(project, '1.1.0')).rejects.toMatchObject({
        exitCode: 1,
    });
    expect(fs.readFileSync(path.join(project, 'local.txt'), 'utf8')).toBe(
        'local',
    );
    const report = path.join(project, '.template/conflicts/1.1.0');
    write(report, 'resolutions.json', JSON.stringify({
        'delete.txt': 'delete',
        'incoming.txt': 'incoming',
        'local.txt': 'local',
        'merged.txt': 'merged',
    }));
    write(report, 'resolved/merged.txt', 'manually merged');

    const result = await updater.continue(project, '1.1.0');

    expect(result.verificationPassed).toBe(false);
    expect(fs.readFileSync(path.join(project, 'local.txt'), 'utf8')).toBe(
        'local',
    );
    expect(fs.readFileSync(path.join(project, 'incoming.txt'), 'utf8')).toBe(
        'incoming',
    );
    expect(fs.readFileSync(path.join(project, 'merged.txt'), 'utf8')).toBe(
        'manually merged',
    );
    expect(fs.existsSync(path.join(project, 'delete.txt'))).toBe(false);
    expect(fs.existsSync(path.join(project, 'added-linter.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe(
        'new canonical basis',
    );
    expect(fs.existsSync(path.join(project, 'AGENTS-DEFAULT.md'))).toBe(false);
    expect(fs.readFileSync(
        path.join(project, 'AGENTS-PROJECT.md'),
        'utf8',
    )).toBe('project rules');
    expect(JSON.parse(fs.readFileSync(
        path.join(project, 'package.json'),
        'utf8',
    ))).toMatchObject({
        name: 'spendwise-like-app',
        version: '9.0.0',
        scripts: { verify: 'new' },
    });
    expect(JSON.parse(fs.readFileSync(
        path.join(project, '.template/version.json'),
        'utf8',
    ))).toMatchObject({ version: '1.1.0' });
    expect(JSON.parse(fs.readFileSync(
        path.join(project, '.template/status.json'),
        'utf8',
    ))).toMatchObject({
        version: '1.1.0',
        verification: 'failed',
    });
    expect(fs.existsSync(report)).toBe(false);
});

test('extracted releases update a project while preserving local files', () => {
    const fixture = temporaryRoot('template-integration-');
    const oldRoot = path.join(fixture, 'repository-1.0.0');
    const newRoot = path.join(fixture, 'repository-1.1.0');
    const local = path.join(fixture, 'project');
    fs.mkdirSync(oldRoot);
    fs.mkdirSync(newRoot);
    fs.mkdirSync(local);
    write(oldRoot, 'managed.txt', 'old');
    write(newRoot, 'managed.txt', 'new');
    write(newRoot, 'added.txt', 'added');
    write(local, 'managed.txt', 'old');
    write(local, 'custom.txt', 'custom');
    writeCanonicalInstructions([oldRoot, newRoot, local]);
    const oldArchive = path.join(fixture, 'old.tar.gz');
    const newArchive = path.join(fixture, 'new.tar.gz');
    ProcessFixtureRunner.run('tar', [
        '-czf',
        oldArchive,
        '-C',
        fixture,
        'repository-1.0.0',
    ]);
    ProcessFixtureRunner.run('tar', [
        '-czf',
        newArchive,
        '-C',
        fixture,
        'repository-1.1.0',
    ]);
    const archives = new ArchiveRepository();
    const oldRelease = archives.extract(fs.readFileSync(oldArchive));
    const newRelease = archives.extract(fs.readFileSync(newArchive));
    roots.push(oldRelease.directory, newRelease.directory);
    const plan = new UpdatePlanner().plan(
        oldRelease.root,
        local,
        newRelease.root,
    );
    const runner = {
        run(): string {
            return '';
        },
    } as ProcessRunner;

    new UpdateTransaction(runner).execute(local, plan.actions, '1.1.0');

    expect(fs.readFileSync(path.join(local, 'managed.txt'), 'utf8')).toBe(
        'new',
    );
    expect(fs.readFileSync(path.join(local, 'added.txt'), 'utf8')).toBe(
        'added',
    );
    expect(fs.readFileSync(path.join(local, 'custom.txt'), 'utf8')).toBe(
        'custom',
    );
});

test('successive updates keep project instructions and refresh the basis', async () => {
    const fixture = temporaryRoot('template-agent-migration-');
    const versions = ['1.0.0', '1.1.0', '1.2.0'];
    const releaseRoots = new Map<string, string>();
    for (const version of versions) {
        const releaseRoot = path.join(fixture, `repository-${version}`);
        fs.mkdirSync(releaseRoot);
        write(releaseRoot, 'package.json', JSON.stringify({
            name: 'template',
            version,
            scripts: { verify: 'verify' },
        }));
        write(
            releaseRoot,
            'AGENTS.md',
            version === '1.0.0'
                ? 'legacy entry'
                : `canonical basis ${version}`,
        );
        if (version === '1.0.0') {
            write(releaseRoot, 'AGENTS-DEFAULT.md', 'legacy defaults');
        }
        releaseRoots.set(version, releaseRoot);
    }

    const project = path.join(fixture, 'project');
    fs.mkdirSync(project);
    write(project, 'package.json', JSON.stringify({
        name: 'application',
        version: '9.0.0',
        scripts: { verify: 'verify' },
    }));
    write(project, 'AGENTS.md', 'locally changed legacy entry');
    write(project, 'AGENTS-DEFAULT.md', 'locally changed legacy defaults');
    write(project, 'AGENTS-PROJECT.md', 'durable project rules');
    write(project, '.template/version.json', JSON.stringify({
        version: '1.0.0',
        repository: 'ghtkuhn/web-app-template',
    }));

    const releases = new Map(
        versions.map((version) => [
            version,
            archive(
                releaseRoots.get(version) as string,
                `agent-release-${version}`,
            ),
        ]),
    );
    const runner = {
        run(): string {
            return '';
        },
    } as ProcessRunner;
    const updater = new TemplateUpdater(runner, () => ({
        async resolve(version?: string) {
            const resolved = version ?? '1.2.0';
            return {
                version: resolved,
                tag: `v${resolved}`,
                archiveUrl: resolved,
            };
        },
        async download(release) {
            return releases.get(release.version) as Buffer;
        },
    }));

    await updater.update(project, '1.1.0');
    expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe(
        'canonical basis 1.1.0',
    );
    expect(fs.existsSync(path.join(project, 'AGENTS-DEFAULT.md'))).toBe(false);
    expect(fs.readFileSync(
        path.join(project, 'AGENTS-PROJECT.md'),
        'utf8',
    )).toBe('durable project rules');

    write(project, 'AGENTS.md', 'locally changed canonical basis');
    await updater.update(project, '1.2.0');
    expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe(
        'canonical basis 1.2.0',
    );
    expect(fs.readFileSync(
        path.join(project, 'AGENTS-PROJECT.md'),
        'utf8',
    )).toBe('durable project rules');
});

test('archive extraction rejects traversal before extracting files', () => {
    const runner = {
        run(_command: string, arguments_: readonly string[]): string {
            if (arguments_[0] === '-tzf') {
                return '../escape.txt';
            }
            throw new Error('Extraction must not run.');
        },
    } as ProcessRunner;

    expect(() => new ArchiveRepository(runner).extract(
        Buffer.from('not-an-archive'),
    )).toThrow(/Unsafe archive entry/);
});

test('archive extraction accepts regular files and rejects symbolic links', () => {
    const fixture = temporaryRoot('template-archive-');
    const releaseRoot = path.join(fixture, 'repository-1.0.0');
    fs.mkdirSync(releaseRoot);
    write(releaseRoot, 'file.txt', 'content');
    const archive = path.join(fixture, 'valid.tar.gz');
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            const result = ProcessFixtureRunner.run(command, arguments_);
            return result;
        },
    } as ProcessRunner;
    ProcessFixtureRunner.run('tar', [
        '-czf',
        archive,
        '-C',
        fixture,
        'repository-1.0.0',
    ]);
    const extracted = new ArchiveRepository(runner).extract(
        fs.readFileSync(archive),
    );
    roots.push(extracted.directory);
    expect(fs.readFileSync(path.join(extracted.root, 'file.txt'), 'utf8'))
        .toBe('content');

    fs.symlinkSync('file.txt', path.join(releaseRoot, 'link.txt'));
    const linkedArchive = path.join(fixture, 'linked.tar.gz');
    ProcessFixtureRunner.run('tar', [
        '-czf',
        linkedArchive,
        '-C',
        fixture,
        'repository-1.0.0',
    ]);
    expect(() => new ArchiveRepository(runner).extract(
        fs.readFileSync(linkedArchive),
    )).toThrow(/link/);
});

/** Small synchronous process adapter used only by archive fixtures. */
class ProcessFixtureRunner {
    public static run(command: string, arguments_: readonly string[]): string {
        const result = spawnSync(command, arguments_, { encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(result.stderr);
        }
        return result.stdout.trim();
    }
}
