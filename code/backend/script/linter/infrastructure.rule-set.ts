import path from 'node:path';
import type {
    LintIssueDraft,
    SourceAnalysis,
    SourceSpan,
} from './interfaces.ts';
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
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        if (path.basename(analysis.filePath) === 'base.database.ts') {
            return [];
        }

        const issues: LintIssueDraft[] = [];
        for (const dependency of analysis.dependencies) {
            if (this.databaseDrivers.has(dependency.source)) {
                issues.push(
                    this.issue(
                        analysis,
                        'DATABASE_DRIVER_OWNERSHIP',
                        `Database driver '${dependency.source}' may only be imported by base.database.ts.`,
                        dependency.location,
                    ),
                );
            }
        }

        const connectionClasses = new Set([
            'Kysely',
            'SqliteDialect',
            'SqliteDriver',
            'PostgresDialect',
            'Pool',
        ]);
        const connection = analysis.constructorCalls.find(
            (constructor) =>
                constructor.className !== null &&
                connectionClasses.has(constructor.className),
        );
        if (connection) {
            issues.push(
                this.issue(
                    analysis,
                    'DATABASE_CONNECTION_CREATION',
                    'Database connections may only be created in base.database.ts.',
                    connection.location,
                ),
            );
        }
        return issues;
    }

    /** Creates one normalized infrastructure issue. */
    private issue(
        analysis: SourceAnalysis,
        ruleId: LintIssueDraft['ruleId'],
        observed: string,
        location?: SourceSpan,
    ): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            observed,
            location,
        };
    }
}
