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

test('metadata falls back to package version for pre-updater projects', () => {
    const project = temporaryRoot('template-metadata-');
    write(project, 'package.json', JSON.stringify({
        version: '1.4.0',
    }));

    expect(new TemplateMetadataRepository().load(project)).toEqual({
        version: '1.4.0',
        repository: 'ghtkuhn/web-app-template',
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

test('planner handles safe deletion and conflicts on modified deletion', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    write(base, 'delete.txt', 'old');
    write(local, 'delete.txt', 'old');
    write(base, 'keep.txt', 'old');
    write(local, 'keep.txt', 'custom');

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions).toContainEqual({
        kind: 'delete',
        relativePath: 'delete.txt',
    });
    expect(plan.conflicts[0]?.relativePath).toBe('keep.txt');
});

test('planner excludes local secrets, runtime data, and agent state', () => {
    const base = temporaryRoot('template-base-');
    const local = temporaryRoot('template-local-');
    const incoming = temporaryRoot('template-incoming-');
    for (const relativePath of [
        '.env',
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

    const plan = new UpdatePlanner().plan(base, local, incoming);

    expect(plan.actions).toEqual([]);
    expect(plan.conflicts).toEqual([]);
});

test('conflict reports contain metadata and three-way variants', () => {
    const project = temporaryRoot('template-project-');
    const base = path.join(project, 'base.txt');
    const local = path.join(project, 'local.txt');
    const incoming = path.join(project, 'incoming.txt');
    fs.writeFileSync(base, 'base');
    fs.writeFileSync(local, 'local');
    fs.writeFileSync(incoming, 'incoming');

    const report = new ConflictReporter().write(project, '2.0.0', [{
        relativePath: 'src/file.ts',
        reason: 'both changed',
        basePath: base,
        localPath: local,
        incomingPath: incoming,
    }]);

    expect(JSON.parse(
        fs.readFileSync(path.join(report, 'conflicts.json'), 'utf8'),
    )).toEqual([{
        path: 'src/file.ts',
        reason: 'both changed',
    }]);
    expect(
        fs.readFileSync(path.join(report, 'incoming/src/file.ts'), 'utf8'),
    ).toBe('incoming');
});

test('transaction rolls project files back when verification fails', () => {
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

    expect(() => new UpdateTransaction(runner).execute(project, [
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
    ])).toThrow(/rolled back/);
    expect(verificationRuns).toBe(1);
    expect(fs.readFileSync(path.join(project, 'existing.txt'), 'utf8')).toBe(
        'old',
    );
    expect(fs.existsSync(path.join(project, 'added.txt'))).toBe(false);
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

    new UpdateTransaction(runner).execute(local, plan.actions);

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
