import path from 'node:path';
import type { LintIssue, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces centralized database-driver and connection ownership. */
export class InfrastructureRuleSet {
    private readonly paths: PathResolver;
    private readonly databaseDrivers = new Set([
        'better-sqlite3',
        'sqlite3',
        'pg',
        'postgres',
    ]);

    /** Creates infrastructure rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates database ownership rules for one backend source file. */
    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        if (path.basename(analysis.filePath) === 'base.database.ts') {
            return [];
        }

        const issues: LintIssue[] = [];
        for (const dependency of analysis.dependencies) {
            if (this.databaseDrivers.has(dependency.source)) {
                issues.push(
                    this.issue(
                        analysis,
                        'DATABASE_DRIVER_IMPORT',
                        `Database driver '${dependency.source}' may only be imported by base.database.ts.`,
                    ),
                );
            }
        }

        const connectionPatterns = [
            /\bnew\s+Kysely\s*</,
            /\bnew\s+Kysely\s*\(/,
            /\bnew\s+SqliteDialect\s*\(/,
            /\bnew\s+SqliteDriver\s*\(/,
        ];
        if (
            connectionPatterns.some((pattern) => pattern.test(analysis.source))
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'DATABASE_CONNECTION_CREATION',
                    'Database connections may only be created in base.database.ts.',
                ),
            );
        }
        return issues;
    }

    /** Creates one normalized infrastructure issue. */
    private issue(
        analysis: SourceAnalysis,
        ruleId: string,
        message: string,
    ): LintIssue {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            message,
        };
    }
}
