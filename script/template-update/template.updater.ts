import fs from 'node:fs';
import path from 'node:path';
import { ArchiveRepository } from './archive.repository.ts';
import { ConflictReporter } from './conflict.reporter.ts';
import { TemplateUpdateError } from './errors.ts';
import { GitHubReleaseClient } from './github.release-client.ts';
import type {
    ConflictSession,
    TemplateMetadata,
    UpdateAction,
    UpdateConflict,
    UpdateExecutionResult,
    UpdatePlan,
    VerificationStatus,
} from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';
import {
    DEFAULT_TEMPLATE_REPOSITORY,
    TemplateMetadataRepository,
} from './template.metadata-repository.ts';
import { UpdatePlanner } from './update.planner.ts';
import { UpdateStatusRepository } from './update-status.repository.ts';
import { UpdateTransaction } from './update.transaction.ts';
import { ProcessRunner } from '../deployment/process.runner.ts';

type PreparedUpdate = {
    readonly installed: TemplateMetadata;
    readonly targetVersion: string;
    readonly currentDirectory: string;
    readonly incomingDirectory: string;
    readonly incomingRoot: string;
    readonly plan: UpdatePlan;
};

type ReleaseClient = Pick<GitHubReleaseClient, 'resolve' | 'download'>;
type ReleaseClientFactory = (repository: string) => ReleaseClient;

/** Coordinates resumable release checks and safe three-way template updates. */
export class TemplateUpdater {
    private readonly metadata = new TemplateMetadataRepository();
    private readonly archives = new ArchiveRepository();
    private readonly planner = new UpdatePlanner();
    private readonly conflicts = new ConflictReporter();
    private readonly transaction: UpdateTransaction;
    private readonly processes: ProcessRunner;
    private readonly statuses = new UpdateStatusRepository();
    private readonly releaseClientFactory: ReleaseClientFactory;

    /** Creates an updater with replaceable process execution for tests. */
    public constructor(
        processes = new ProcessRunner(),
        releaseClientFactory: ReleaseClientFactory = (repository) =>
            new GitHubReleaseClient(repository),
    ) {
        this.processes = processes;
        this.transaction = new UpdateTransaction(processes);
        this.releaseClientFactory = releaseClientFactory;
    }

    /** Initializes explicit metadata for one legacy project. */
    public async initialize(
        projectRoot: string,
        installedVersion: string,
    ): Promise<TemplateMetadata> {
        this.assertClean(projectRoot);
        if (this.metadata.exists(projectRoot)) {
            throw new TemplateUpdateError(
                'Template metadata already exists.',
                1,
            );
        }
        const version = this.version(installedVersion);
        await this.client(DEFAULT_TEMPLATE_REPOSITORY).resolve(version);
        const metadata = {
            version,
            repository: DEFAULT_TEMPLATE_REPOSITORY,
        };
        this.metadata.render(
            path.join(projectRoot, '.template/version.json'),
            metadata,
        );
        return metadata;
    }

    /** Returns installed/latest versions and pending operator state. */
    public async check(projectRoot: string): Promise<{
        readonly current: string;
        readonly latest: string;
        readonly pending: readonly string[];
        readonly verification: VerificationStatus | null;
    }> {
        const installed = this.installed(projectRoot);
        const latest = await this.client(installed.repository).resolve();
        return {
            current: installed.version,
            latest: latest.version,
            pending: this.conflicts.pending(projectRoot),
            verification: this.statuses.load(projectRoot),
        };
    }

    /** Updates directly or creates a resumable conflict session. */
    public async update(
        projectRoot: string,
        requestedVersion?: string,
    ): Promise<{
        readonly current: string;
        readonly updated: boolean;
        readonly verificationPassed: boolean;
        readonly logPath?: string;
    }> {
        this.assertClean(projectRoot);
        const installed = this.installed(projectRoot);
        const client = this.client(installed.repository);
        const target = await client.resolve(
            requestedVersion
                ? this.version(requestedVersion)
                : undefined,
        );
        const targetState = this.targetState(
            installed.version,
            target.version,
        );
        if (targetState === 'current') {
            return {
                current: installed.version,
                updated: false,
                verificationPassed: true,
            };
        }

        const prepared = await this.prepare(
            projectRoot,
            installed,
            target.version,
        );
        try {
            if (prepared.plan.conflicts.length > 0) {
                const report = this.conflicts.write(
                    projectRoot,
                    installed,
                    target.version,
                    prepared.plan.conflicts,
                );
                throw new TemplateUpdateError(
                    `${prepared.plan.conflicts.length} update conflict(s); resolve ${report}/resolutions.json and run template:update -- --continue ${target.version}.`,
                    1,
                );
            }
            return this.complete(
                projectRoot,
                installed,
                target.version,
                prepared.incomingRoot,
                prepared.plan.actions,
            );
        } finally {
            this.cleanup(prepared);
        }
    }

    /** Continues a fingerprint-validated conflict session. */
    public async continue(
        projectRoot: string,
        targetVersion: string,
    ): Promise<{
        readonly current: string;
        readonly updated: true;
        readonly verificationPassed: boolean;
        readonly logPath: string;
    }> {
        this.assertClean(projectRoot);
        const version = this.version(targetVersion);
        const installed = this.installed(projectRoot);
        const session = this.conflicts.load(projectRoot, version);
        this.assertSession(session, installed);
        const prepared = await this.prepare(
            projectRoot,
            installed,
            version,
        );
        try {
            this.conflicts.assertCurrent(
                session,
                prepared.plan.conflicts,
            );
            const resolutions = this.conflicts.resolutions(
                projectRoot,
                session,
            );
            const actions = [
                ...prepared.plan.actions,
                ...this.resolutionActions(
                    projectRoot,
                    version,
                    prepared.plan.conflicts,
                    resolutions,
                ),
            ];
            const result = this.complete(
                projectRoot,
                installed,
                version,
                prepared.incomingRoot,
                actions,
            );
            this.conflicts.remove(projectRoot, version);
            return {
                current: result.current,
                updated: true,
                verificationPassed: result.verificationPassed,
                logPath: result.logPath as string,
            };
        } finally {
            this.cleanup(prepared);
        }
    }

    /** Aborts one ignored conflict session without touching project files. */
    public abort(projectRoot: string, targetVersion: string): void {
        const version = this.version(targetVersion);
        this.conflicts.remove(projectRoot, version);
    }

    /** Downloads both releases and computes a fresh local plan. */
    private async prepare(
        projectRoot: string,
        installed: TemplateMetadata,
        targetVersion: string,
    ): Promise<PreparedUpdate> {
        const client = this.client(installed.repository);
        const [currentRelease, targetRelease] = await Promise.all([
            client.resolve(installed.version),
            client.resolve(targetVersion),
        ]);
        const [currentArchive, targetArchive] = await Promise.all([
            client.download(currentRelease),
            client.download(targetRelease),
        ]);
        const current = this.archives.extract(currentArchive);
        let incoming: ReturnType<ArchiveRepository['extract']> | undefined;
        try {
            incoming = this.archives.extract(targetArchive);
            return {
                installed,
                targetVersion,
                currentDirectory: current.directory,
                incomingDirectory: incoming.directory,
                incomingRoot: incoming.root,
                plan: this.planner.plan(
                    current.root,
                    projectRoot,
                    incoming.root,
                ),
            };
        } catch (error) {
            fs.rmSync(current.directory, { recursive: true, force: true });
            if (incoming) {
                fs.rmSync(incoming.directory, {
                    recursive: true,
                    force: true,
                });
            }
            throw error;
        }
    }

    /** Applies actions, records target metadata, and stores Verify state. */
    private complete(
        projectRoot: string,
        installed: TemplateMetadata,
        targetVersion: string,
        incomingRoot: string,
        actions: readonly UpdateAction[],
    ): {
        readonly current: string;
        readonly updated: true;
        readonly verificationPassed: boolean;
        readonly logPath: string;
    } {
        const allActions = [
            ...actions,
            this.metadataAction(
                incomingRoot,
                targetVersion,
                installed.repository,
            ),
        ].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
        );
        const result = this.apply(projectRoot, allActions, targetVersion);
        this.statuses.write(projectRoot, {
            schemaVersion: 1,
            version: targetVersion,
            verification: result.verificationPassed ? 'passed' : 'failed',
            logPath: result.logPath,
        });
        return {
            current: targetVersion,
            updated: true,
            verificationPassed: result.verificationPassed,
            logPath: result.logPath,
        };
    }

    /** Materializes explicit conflict decisions into trusted update actions. */
    private resolutionActions(
        projectRoot: string,
        targetVersion: string,
        conflicts: readonly UpdateConflict[],
        resolutions: Readonly<Record<string, string>>,
    ): UpdateAction[] {
        const actions: UpdateAction[] = [];
        for (const conflict of conflicts) {
            const id = conflict.id ?? conflict.relativePath;
            const resolution = resolutions[id];
            if (resolution === 'local') {
                continue;
            }
            if (resolution === 'delete') {
                actions.push({
                    kind: 'delete',
                    relativePath: conflict.relativePath,
                });
                continue;
            }
            const sourcePath =
                resolution === 'merged'
                    ? this.conflicts.mergedPath(
                          projectRoot,
                          targetVersion,
                          conflict.relativePath,
                      )
                    : conflict.incomingPath;
            if (!sourcePath) {
                actions.push({
                    kind: 'delete',
                    relativePath: conflict.relativePath,
                });
                continue;
            }
            actions.push({
                kind: 'write',
                relativePath: conflict.relativePath,
                sourcePath,
                mode: fs.statSync(sourcePath).mode & 0o777,
            });
        }
        return actions;
    }

    /** Rejects stale sessions before any project mutation. */
    private assertSession(
        session: ConflictSession,
        installed: TemplateMetadata,
    ): void {
        if (
            session.fromVersion !== installed.version ||
            session.repository !== installed.repository
        ) {
            throw new TemplateUpdateError(
                'Conflict session does not match installed template metadata.',
                1,
            );
        }
    }

    /** Returns whether the target is a supported forward update. */
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

    /** Applies installation actions with rollback for execution failures. */
    private apply(
        projectRoot: string,
        actions: readonly UpdateAction[],
        targetVersion: string,
    ): UpdateExecutionResult {
        try {
            return this.transaction.execute(
                projectRoot,
                actions,
                targetVersion,
            );
        } catch (error) {
            throw new TemplateUpdateError(String(error), 2);
        }
    }

    /** Creates staged target metadata as the final managed write. */
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

    /** Removes extracted archives after the plan has been consumed. */
    private cleanup(prepared: PreparedUpdate): void {
        fs.rmSync(prepared.currentDirectory, {
            recursive: true,
            force: true,
        });
        fs.rmSync(prepared.incomingDirectory, {
            recursive: true,
            force: true,
        });
    }

    /** Requires a clean tracked and untracked worktree before mutations. */
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

    /** Creates the repository-scoped release transport. */
    private client(repository: string): ReleaseClient {
        return this.releaseClientFactory(repository);
    }

    /** Loads required explicit metadata with an actionable legacy error. */
    private installed(projectRoot: string): TemplateMetadata {
        if (!this.metadata.exists(projectRoot)) {
            throw new TemplateUpdateError(
                'Template metadata is missing; run npm run template:init -- <installed-version>.',
                1,
            );
        }
        return this.metadata.load(projectRoot);
    }

    /** Converts user-provided versions into controlled input errors. */
    private version(value: string): string {
        try {
            return new SemanticVersion(value).value;
        } catch (error) {
            throw new TemplateUpdateError(String(error), 1);
        }
    }
}
