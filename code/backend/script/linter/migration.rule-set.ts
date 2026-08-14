import fs from 'node:fs';
import path from 'node:path';
import type { LintIssueDraft } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

const DIALECTS = ['sqlite', 'postgres'] as const;

/** Enforces complete and logically aligned database migration catalogs. */
export class MigrationRuleSet {
    private readonly paths: PathResolver;

    /** Creates migration rules for one project path model. */
    public constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Checks catalog placement, filenames, and logical dialect parity. */
    public evaluate(): LintIssueDraft[] {
        const root = this.paths.migrationRoot();
        if (!fs.existsSync(root)) {
            return [];
        }
        return [
            ...this.structureIssues(root),
            ...this.parityIssues(root),
        ];
    }

    private structureIssues(root: string): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(root, entry.name);
            if (!entry.isDirectory() || !DIALECTS.includes(
                entry.name as (typeof DIALECTS)[number],
            )) {
                issues.push(this.structureIssue(entryPath));
            }
        }
        for (const dialect of DIALECTS) {
            const dialectRoot = path.join(root, dialect);
            if (!fs.existsSync(dialectRoot)) {
                issues.push(this.structureIssue(dialectRoot));
                continue;
            }
            for (const entry of fs.readdirSync(dialectRoot, {
                withFileTypes: true,
            })) {
                if (
                    !entry.isFile() ||
                    !/^\d{3}-[a-z][a-z0-9-]*\.migration\.ts$/u.test(entry.name)
                ) {
                    issues.push(
                        this.structureIssue(path.join(dialectRoot, entry.name)),
                    );
                }
            }
        }
        return issues;
    }

    private parityIssues(root: string): LintIssueDraft[] {
        const sqlite = this.migrationNames(path.join(root, 'sqlite'));
        const postgres = this.migrationNames(path.join(root, 'postgres'));
        const names = [...new Set([...sqlite, ...postgres])].sort(
            (left, right) => left.localeCompare(right),
        );
        return names.flatMap((name) => {
            const missing = DIALECTS.filter((dialect) =>
                dialect === 'sqlite'
                    ? !sqlite.includes(name)
                    : !postgres.includes(name),
            );
            return missing.map((dialect) => ({
                ruleId: 'MIGRATION_DIALECT_PARITY',
                severity: 'error' as const,
                file: this.paths.relative(path.join(root, dialect, name)),
                message:
                    `Migration '${name}' is missing from the ${dialect} catalog.`,
            }));
        });
    }

    private migrationNames(directory: string): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isFile() && entry.name.endsWith('.migration.ts'),
            )
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
    }

    private structureIssue(filePath: string): LintIssueDraft {
        return {
            ruleId: 'MIGRATION_DIALECT_STRUCTURE',
            severity: 'error',
            file: this.paths.relative(filePath),
            message:
                'Migrations must be direct <number>-<kebab-case>.migration.ts files under src/migration/sqlite or src/migration/postgres.',
        };
    }
}
