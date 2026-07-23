import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateAction } from './interfaces.ts';
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
    ): void {
        const backupRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), 'template-update-rollback-'),
        );
        const existing = new Set<string>();
        try {
            this.backup(projectRoot, backupRoot, actions, existing);
            this.apply(projectRoot, actions);
            this.install(projectRoot);
            this.processes.run('npm', ['run', 'verify'], { cwd: projectRoot });
            fs.rmSync(backupRoot, { recursive: true, force: true });
        } catch (error) {
            try {
                this.rollback(projectRoot, backupRoot, actions, existing);
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
        this.processes.run(
            'npm',
            ['install', '--package-lock=false'],
            { cwd: projectRoot },
        );
    }
}
