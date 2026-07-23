import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    ConflictResolution,
    ConflictSession,
    TemplateMetadata,
    UpdateConflict,
} from './interfaces.ts';

/** Persists deterministic, ignored conflict sessions and three-way variants. */
export class ConflictReporter {
    /** Creates a resumable conflict session without changing project files. */
    public write(
        projectRoot: string,
        installed: TemplateMetadata,
        targetVersion: string,
        conflicts: readonly UpdateConflict[],
    ): string {
        const reportRoot = this.root(projectRoot, targetVersion);
        fs.rmSync(reportRoot, { recursive: true, force: true });
        fs.mkdirSync(reportRoot, { recursive: true });
        const session: ConflictSession = {
            schemaVersion: 1,
            repository: installed.repository,
            fromVersion: installed.version,
            targetVersion,
            conflicts: conflicts.map((conflict) =>
                this.fingerprint(conflict),
            ),
        };
        this.writeJson(path.join(reportRoot, 'session.json'), session);
        this.writeJson(
            path.join(reportRoot, 'conflicts.json'),
            session.conflicts.map((conflict) => ({
                id: conflict.id,
                path: conflict.path,
                reason: conflict.reason,
            })),
        );
        this.writeJson(
            path.join(reportRoot, 'resolutions.json'),
            Object.fromEntries(
                session.conflicts.map((conflict) => [
                    conflict.id,
                    'unresolved',
                ]),
            ),
        );
        for (const conflict of conflicts) {
            this.copy(reportRoot, conflict.relativePath, 'base', conflict.basePath);
            this.copy(reportRoot, conflict.relativePath, 'local', conflict.localPath);
            this.copy(
                reportRoot,
                conflict.relativePath,
                'incoming',
                conflict.incomingPath,
            );
        }
        return reportRoot;
    }

    /** Loads and validates one stored conflict session. */
    public load(projectRoot: string, targetVersion: string): ConflictSession {
        const filePath = path.join(
            this.root(projectRoot, targetVersion),
            'session.json',
        );
        if (!fs.existsSync(filePath)) {
            throw new Error(
                `No pending conflict session for ${targetVersion}.`,
            );
        }
        const session = JSON.parse(
            fs.readFileSync(filePath, 'utf8'),
        ) as ConflictSession;
        if (
            session.schemaVersion !== 1 ||
            session.targetVersion !== targetVersion ||
            !Array.isArray(session.conflicts)
        ) {
            throw new Error(`Invalid conflict session for ${targetVersion}.`);
        }
        return session;
    }

    /** Loads explicit, complete conflict decisions. */
    public resolutions(
        projectRoot: string,
        session: ConflictSession,
    ): Readonly<Record<string, Exclude<ConflictResolution, 'unresolved'>>> {
        const filePath = path.join(
            this.root(projectRoot, session.targetVersion),
            'resolutions.json',
        );
        const source = JSON.parse(
            fs.readFileSync(filePath, 'utf8'),
        ) as Record<string, ConflictResolution>;
        const expected = new Set(
            session.conflicts.map((conflict) => conflict.id),
        );
        if (
            Object.keys(source).some((id) => !expected.has(id)) ||
            Object.keys(source).length !== expected.size
        ) {
            throw new Error('Conflict resolutions do not match the session.');
        }
        const allowed = new Set([
            'local',
            'incoming',
            'merged',
            'delete',
        ]);
        for (const id of expected) {
            if (!allowed.has(source[id])) {
                throw new Error(`Conflict '${id}' is not resolved.`);
            }
        }
        return source as Record<
            string,
            Exclude<ConflictResolution, 'unresolved'>
        >;
    }

    /** Returns a validated manually merged file. */
    public mergedPath(
        projectRoot: string,
        targetVersion: string,
        relativePath: string,
    ): string {
        const filePath = path.join(
            this.root(projectRoot, targetVersion),
            'resolved',
            relativePath,
        );
        if (!fs.existsSync(filePath)) {
            throw new Error(`Merged resolution '${relativePath}' is missing.`);
        }
        const status = fs.lstatSync(filePath);
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(
                `Merged resolution '${relativePath}' must be a regular file.`,
            );
        }
        return filePath;
    }

    /** Ensures a recomputed plan still matches the stored session. */
    public assertCurrent(
        session: ConflictSession,
        conflicts: readonly UpdateConflict[],
    ): void {
        const current = conflicts.map((conflict) =>
            this.fingerprint(conflict),
        );
        if (JSON.stringify(current) !== JSON.stringify(session.conflicts)) {
            throw new Error(
                'Conflict session is stale; run template:update again.',
            );
        }
    }

    /** Lists pending target versions deterministically. */
    public pending(projectRoot: string): string[] {
        const directory = path.join(projectRoot, '.template/conflicts');
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs
            .readdirSync(directory, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    fs.existsSync(
                        path.join(directory, entry.name, 'session.json'),
                    ),
            )
            .map((entry) => entry.name)
            .sort();
    }

    /** Removes only one ignored conflict session. */
    public remove(projectRoot: string, targetVersion: string): void {
        const reportRoot = this.root(projectRoot, targetVersion);
        if (!fs.existsSync(reportRoot)) {
            throw new Error(
                `No pending conflict session for ${targetVersion}.`,
            );
        }
        fs.rmSync(reportRoot, { recursive: true, force: true });
    }

    /** Returns the exact ignored session root. */
    private root(projectRoot: string, targetVersion: string): string {
        return path.join(
            projectRoot,
            '.template/conflicts',
            targetVersion,
        );
    }

    /** Copies one available conflict variant. */
    private copy(
        reportRoot: string,
        relativePath: string,
        variant: string,
        sourcePath?: string,
    ): void {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return;
        }
        const target = path.join(reportRoot, variant, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(sourcePath, target);
    }

    /** Returns a SHA-256 fingerprint for one available regular file. */
    private hash(filePath?: string): string | null {
        if (!filePath || !fs.existsSync(filePath)) {
            return null;
        }
        return createHash('sha256')
            .update(fs.readFileSync(filePath))
            .digest('hex');
    }

    /** Creates the stable identity of one recomputed conflict. */
    private fingerprint(
        conflict: UpdateConflict,
    ): ConflictSession['conflicts'][number] {
        return {
            id: conflict.id ?? conflict.relativePath,
            path: conflict.relativePath,
            reason: conflict.reason,
            baseHash: this.hash(conflict.basePath),
            localHash: this.hash(conflict.localPath),
            incomingHash: this.hash(conflict.incomingPath),
        };
    }

    /** Writes deterministic JSON with a trailing newline. */
    private writeJson(filePath: string, value: unknown): void {
        fs.writeFileSync(
            filePath,
            `${JSON.stringify(value, null, 4)}\n`,
            'utf8',
        );
    }
}
