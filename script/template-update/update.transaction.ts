import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateAction } from './interfaces.ts';
import type { UpdateExecutionResult } from './interfaces.ts';
import { ProcessRunner } from '../deployment/process.runner.ts';

/** Applies update actions transactionally and verifies the resulting project. */
export class UpdateTransaction {
    private readonly processes: ProcessRunner;

    public constructor(processes = new ProcessRunner()) {
        this.processes = processes;
    }

    /** Applies all actions, installs dependencies, and runs full verification. */
    public execute(
        projectRoot: string,
        actions: readonly UpdateAction[],
        targetVersion: string,
    ): UpdateExecutionResult {
        const backupRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), 'template-update-rollback-'),
        );
        const existing = new Set<string>();
        try {
            this.backup(projectRoot, backupRoot, actions, existing);
            this.backupLockfile(projectRoot, backupRoot, existing);
            this.apply(
                projectRoot,
                actions.filter((action) => !this.metadata(action)),
            );
            this.install(projectRoot);
            this.apply(
                projectRoot,
                actions.filter((action) => this.metadata(action)),
            );
            fs.rmSync(backupRoot, { recursive: true, force: true });
        } catch (error) {
            try {
                this.rollback(projectRoot, backupRoot, actions, existing);
                this.rollbackLockfile(projectRoot, backupRoot, existing);
                this.install(projectRoot);
                fs.rmSync(backupRoot, { recursive: true, force: true });
            } catch (rollbackError) {
                throw new Error(
                    `Template update failed (${String(error)}) and rollback requires manual recovery from '${backupRoot}': ${String(rollbackError)}`,
                );
            }
            throw new Error(
                `Template update failed and was rolled back: ${String(error)}`,
            );
        }
        return this.verify(projectRoot, targetVersion);
    }

    private backup(
        projectRoot: string,
        backupRoot: string,
        actions: readonly UpdateAction[],
        existing: Set<string>,
    ): void {
        for (const action of actions) {
            const source = path.join(projectRoot, action.relativePath);
            if (!fs.existsSync(source)) {
                continue;
            }
            existing.add(action.relativePath);
            const target = path.join(backupRoot, action.relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
            fs.chmodSync(target, fs.statSync(source).mode & 0o777);
        }
    }

    private apply(projectRoot: string, actions: readonly UpdateAction[]): void {
        for (const action of actions) {
            const target = path.join(projectRoot, action.relativePath);
            if (action.kind === 'delete') {
                fs.rmSync(target, { force: true });
                continue;
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const temporary = `${target}.template-update`;
            fs.copyFileSync(action.sourcePath, temporary);
            fs.chmodSync(temporary, action.mode);
            fs.renameSync(temporary, target);
        }
    }

    private rollback(
        projectRoot: string,
        backupRoot: string,
        actions: readonly UpdateAction[],
        existing: Set<string>,
    ): void {
        for (const action of [...actions].reverse()) {
            const target = path.join(projectRoot, action.relativePath);
            if (!existing.has(action.relativePath)) {
                fs.rmSync(target, { force: true });
                continue;
            }
            const backup = path.join(backupRoot, action.relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(backup, target);
            fs.chmodSync(target, fs.statSync(backup).mode & 0o777);
        }
    }

    private install(projectRoot: string): void {
        this.processes.run('npm', ['install'], { cwd: projectRoot });
    }

    /** Identifies metadata that becomes authoritative only after install. */
    private metadata(action: UpdateAction): boolean {
        return action.relativePath === '.template/version.json';
    }

    /** Includes the regenerated root lockfile in rollback coverage. */
    private backupLockfile(
        projectRoot: string,
        backupRoot: string,
        existing: Set<string>,
    ): void {
        const relativePath = 'package-lock.json';
        const source = path.join(projectRoot, relativePath);
        if (!fs.existsSync(source)) {
            return;
        }
        existing.add(relativePath);
        fs.copyFileSync(source, path.join(backupRoot, relativePath));
    }

    /** Restores or removes the generated lockfile after installation failure. */
    private rollbackLockfile(
        projectRoot: string,
        backupRoot: string,
        existing: Set<string>,
    ): void {
        const relativePath = 'package-lock.json';
        const target = path.join(projectRoot, relativePath);
        if (!existing.has(relativePath)) {
            fs.rmSync(target, { force: true });
            return;
        }
        fs.copyFileSync(path.join(backupRoot, relativePath), target);
    }

    /** Runs post-install verification without rolling back installed updates. */
    private verify(
        projectRoot: string,
        targetVersion: string,
    ): UpdateExecutionResult {
        const relativeLogPath =
            `.template/logs/update-${targetVersion}-verify.log`;
        const logPath = path.join(projectRoot, relativeLogPath);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        try {
            const output = this.processes.run(
                'npm',
                ['run', 'verify'],
                { cwd: projectRoot },
            );
            fs.writeFileSync(logPath, `${output}\n`, 'utf8');
            return {
                verificationPassed: true,
                logPath: relativeLogPath,
            };
        } catch (error: unknown) {
            fs.writeFileSync(logPath, `${String(error)}\n`, 'utf8');
            return {
                verificationPassed: false,
                logPath: relativeLogPath,
            };
        }
    }
}
