import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessRunner } from '../deployment/process.runner.ts';

/** Validates and extracts GitHub source archives into isolated directories. */
export class ArchiveRepository {
    private readonly processes: ProcessRunner;

    public constructor(processes = new ProcessRunner()) {
        this.processes = processes;
    }

    /** Extracts an archive and returns its single repository root. */
    public extract(archive: Buffer): {
        readonly directory: string;
        readonly root: string;
    } {
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'template-update-archive-'),
        );
        const archivePath = path.join(directory, 'release.tar.gz');
        const extractionRoot = path.join(directory, 'content');
        fs.writeFileSync(archivePath, archive);
        fs.mkdirSync(extractionRoot);
        try {
            const entries = this.processes.run(
                'tar',
                ['-tzf', archivePath],
            ).split('\n').filter(Boolean);
            this.validateEntries(entries);
            const details = this.processes.run(
                'tar',
                ['-tvzf', archivePath],
            ).split('\n').filter(Boolean);
            if (details.some((entry) => ['l', 'h'].includes(entry[0]))) {
                throw new Error('Release archive links are not supported.');
            }
            this.processes.run(
                'tar',
                ['-xzf', archivePath, '-C', extractionRoot],
            );
            const roots = fs.readdirSync(extractionRoot);
            if (roots.length !== 1) {
                throw new Error('Release archive must contain one root directory.');
            }
            const root = path.join(extractionRoot, roots[0]);
            if (!fs.statSync(root).isDirectory()) {
                throw new Error('Release archive root must be a directory.');
            }
            this.rejectLinks(root);
            return { directory, root };
        } catch (error) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }

    private validateEntries(entries: readonly string[]): void {
        if (entries.length === 0) {
            throw new Error('Release archive is empty.');
        }
        const root = entries[0].split('/')[0];
        for (const entry of entries) {
            const normalized = path.posix.normalize(entry);
            if (
                entry.startsWith('/') ||
                normalized === '..' ||
                normalized.startsWith('../') ||
                entry.split('/')[0] !== root
            ) {
                throw new Error(`Unsafe archive entry '${entry}'.`);
            }
        }
    }

    private rejectLinks(directory: string): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            const status = fs.lstatSync(entryPath);
            if (status.isSymbolicLink()) {
                throw new Error(`Archive link '${entry.name}' is not supported.`);
            }
            if (status.isDirectory()) {
                this.rejectLinks(entryPath);
            }
        }
    }
}
