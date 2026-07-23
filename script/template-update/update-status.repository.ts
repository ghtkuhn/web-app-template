import fs from 'node:fs';
import path from 'node:path';
import type { VerificationStatus } from './interfaces.ts';

/** Stores ignored post-update verification state for operator visibility. */
export class UpdateStatusRepository {
    /** Writes the latest verification result. */
    public write(projectRoot: string, status: VerificationStatus): void {
        const filePath = this.path(projectRoot);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(
            filePath,
            `${JSON.stringify(status, null, 4)}\n`,
            'utf8',
        );
    }

    /** Loads the latest status when present. */
    public load(projectRoot: string): VerificationStatus | null {
        const filePath = this.path(projectRoot);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const status = JSON.parse(
            fs.readFileSync(filePath, 'utf8'),
        ) as Partial<VerificationStatus>;
        if (
            status.schemaVersion !== 1 ||
            typeof status.version !== 'string' ||
            !['passed', 'failed'].includes(status.verification ?? '') ||
            typeof status.logPath !== 'string'
        ) {
            throw new Error('Invalid template update status metadata.');
        }
        return status as VerificationStatus;
    }

    /** Returns the ignored status path. */
    private path(projectRoot: string): string {
        return path.join(projectRoot, '.template/status.json');
    }
}
