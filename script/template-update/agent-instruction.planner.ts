import fs from 'node:fs';
import path from 'node:path';
import type { UpdateAction } from './interfaces.ts';

const CANONICAL_INSTRUCTIONS = 'AGENTS.md';
const LEGACY_INSTRUCTIONS = 'AGENTS-DEFAULT.md';
const PROJECT_INSTRUCTIONS = 'AGENTS-PROJECT.md';

/** Plans authoritative agent instructions outside the normal three-way merge. */
export class AgentInstructionPlanner {
    /** Returns whether this path belongs to the instruction migration policy. */
    public owns(relativePath: string): boolean {
        return [
            CANONICAL_INSTRUCTIONS,
            LEGACY_INSTRUCTIONS,
            PROJECT_INSTRUCTIONS,
        ].includes(relativePath);
    }

    /** Replaces template rules, removes legacy rules, and preserves project rules. */
    public plan(localRoot: string, incomingRoot: string): UpdateAction[] {
        const incoming = path.join(incomingRoot, CANONICAL_INSTRUCTIONS);
        const incomingStatus = this.regularStatus(
            incoming,
            'Incoming template release must contain a regular AGENTS.md file.',
        );

        const local = path.join(localRoot, CANONICAL_INSTRUCTIONS);
        const legacy = path.join(localRoot, LEGACY_INSTRUCTIONS);
        const localStatus = this.optionalRegularStatus(
            local,
            'Local AGENTS.md must be a regular file before template update.',
        );
        const legacyStatus = this.optionalRegularStatus(
            legacy,
            'Local AGENTS-DEFAULT.md must be a regular file before template update.',
        );

        const actions: UpdateAction[] = [];
        if (!localStatus || !this.equal(local, incoming)) {
            actions.push({
                kind: 'write',
                relativePath: CANONICAL_INSTRUCTIONS,
                sourcePath: incoming,
                mode: incomingStatus.mode & 0o777,
            });
        }
        if (legacyStatus) {
            actions.push({
                kind: 'delete',
                relativePath: LEGACY_INSTRUCTIONS,
            });
        }
        return actions;
    }

    private optionalRegularStatus(
        filePath: string,
        message: string,
    ): fs.Stats | null {
        const status = this.pathStatus(filePath);
        if (!status) {
            return null;
        }
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(message);
        }
        return status;
    }

    private regularStatus(filePath: string, message: string): fs.Stats {
        const status = this.pathStatus(filePath);
        if (!status || !status.isFile() || status.isSymbolicLink()) {
            throw new Error(message);
        }
        return status;
    }

    private pathStatus(filePath: string): fs.Stats | null {
        try {
            return fs.lstatSync(filePath);
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                return null;
            }
            throw error;
        }
    }

    private equal(first: string, second: string): boolean {
        return fs.readFileSync(first).equals(fs.readFileSync(second)) &&
            (fs.statSync(first).mode & 0o777) ===
                (fs.statSync(second).mode & 0o777);
    }
}
