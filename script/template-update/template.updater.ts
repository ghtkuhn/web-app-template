import fs from 'node:fs';
import path from 'node:path';
import { ArchiveRepository } from './archive.repository.ts';
import { ConflictReporter } from './conflict.reporter.ts';
import { TemplateUpdateError } from './errors.ts';
import { GitHubReleaseClient } from './github.release-client.ts';
import type { UpdateAction } from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';
import { TemplateMetadataRepository } from './template.metadata-repository.ts';
import { UpdatePlanner } from './update.planner.ts';
import { UpdateTransaction } from './update.transaction.ts';
import { ProcessRunner } from '../deployment/process.runner.ts';

/** Coordinates safe release checks and three-way template updates. */
export class TemplateUpdater {
    private readonly metadata = new TemplateMetadataRepository();
    private readonly archives = new ArchiveRepository();
    private readonly planner = new UpdatePlanner();
    private readonly conflicts = new ConflictReporter();
    private readonly transaction = new UpdateTransaction();
    private readonly processes = new ProcessRunner();

    /** Returns installed and latest stable template versions. */
    public async check(projectRoot: string): Promise<{
        readonly current: string;
        readonly latest: string;
    }> {
        const installed = this.metadata.load(projectRoot);
        const latest = await new GitHubReleaseClient(
            installed.repository,
        ).resolve();
        return { current: installed.version, latest: latest.version };
    }

    /** Updates the project to the latest or explicitly requested release. */
    public async update(
        projectRoot: string,
        requestedVersion?: string,
    ): Promise<{ readonly current: string; readonly updated: boolean }> {
        this.assertClean(projectRoot);
        const installed = this.metadata.load(projectRoot);
        const client = new GitHubReleaseClient(installed.repository);
        const target = await client.resolve(requestedVersion);
        const targetState = this.targetState(
            installed.version,
            target.version,
        );
        if (targetState === 'current') {
            return { current: installed.version, updated: false };
        }

        const currentRelease = await client.resolve(installed.version);
        const [currentArchive, targetArchive] = await Promise.all([
            client.download(currentRelease),
            client.download(target),
        ]);
        const current = this.archives.extract(currentArchive);
        const incoming = this.archives.extract(targetArchive);
        try {
            const plan = this.planner.plan(
                current.root,
                projectRoot,
                incoming.root,
            );
            this.assertConflictFree(projectRoot, target.version, plan.conflicts);
            const actions = [
                ...plan.actions,
                this.metadataAction(
                    incoming.root,
                    target.version,
                    installed.repository,
                ),
            ];
            this.apply(projectRoot, actions);
            return { current: target.version, updated: true };
        } finally {
            fs.rmSync(current.directory, { recursive: true, force: true });
            fs.rmSync(incoming.directory, { recursive: true, force: true });
        }
    }

    private targetState(
        installedVersion: string,
        targetVersion: string,
    ): 'current' | 'newer' {
        const comparison = new SemanticVersion(targetVersion).compare(
            new SemanticVersion(installedVersion),
        );
        if (comparison < 0) {
            throw new TemplateUpdateError(
                `Downgrade from ${installedVersion} to ${targetVersion} is not supported.`,
                1,
            );
        }
        return comparison === 0 ? 'current' : 'newer';
    }

    private assertConflictFree(
        projectRoot: string,
        targetVersion: string,
        conflicts: Parameters<ConflictReporter['write']>[2],
    ): void {
        if (conflicts.length === 0) {
            return;
        }
        const report = this.conflicts.write(
            projectRoot,
            targetVersion,
            conflicts,
        );
        throw new TemplateUpdateError(
            `${conflicts.length} update conflict(s); report: ${report}`,
            1,
        );
    }

    private apply(projectRoot: string, actions: readonly UpdateAction[]): void {
        try {
            this.transaction.execute(projectRoot, actions);
        } catch (error) {
            throw new TemplateUpdateError(String(error), 2);
        }
    }

    private metadataAction(
        stagingRoot: string,
        version: string,
        repository: string,
    ): UpdateAction {
        const sourcePath = path.join(stagingRoot, '.template-version.json');
        this.metadata.render(sourcePath, { version, repository });
        return {
            kind: 'write',
            relativePath: '.template/version.json',
            sourcePath,
            mode: 0o644,
        };
    }

    private assertClean(projectRoot: string): void {
        let status: string;
        try {
            status = this.processes.run(
                'git',
                ['status', '--porcelain', '--untracked-files=all'],
                { cwd: projectRoot },
            );
        } catch (error) {
            throw new TemplateUpdateError(
                `Unable to inspect Git worktree: ${String(error)}`,
                1,
            );
        }
        if (status) {
            throw new TemplateUpdateError(
                'Template update requires a clean Git worktree.',
                1,
            );
        }
    }
}
