import fs from 'node:fs';
import path from 'node:path';
import type { UpdateConflict } from './interfaces.ts';

/** Writes deterministic, ignored conflict artifacts for manual resolution. */
export class ConflictReporter {
    /** Writes a report and all available three-way file variants. */
    public write(
        projectRoot: string,
        targetVersion: string,
        conflicts: readonly UpdateConflict[],
    ): string {
        const reportRoot = path.join(
            projectRoot,
            '.template/conflicts',
            targetVersion,
        );
        fs.rmSync(reportRoot, { recursive: true, force: true });
        fs.mkdirSync(reportRoot, { recursive: true });
        const report = conflicts.map((conflict) => ({
            path: conflict.relativePath,
            reason: conflict.reason,
        }));
        fs.writeFileSync(
            path.join(reportRoot, 'conflicts.json'),
            `${JSON.stringify(report, null, 4)}\n`,
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
}
