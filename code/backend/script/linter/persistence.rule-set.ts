import fs from 'node:fs';
import path from 'node:path';
import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces typed persistence mapping and Domain Object invariants. */
export class PersistenceRuleSet {
    private readonly paths: PathResolver;

    /** Creates persistence rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates persistence rules for one domain source file. */
    // fallow-ignore-next-line complexity -- Declarative dispatcher for independently tested persistence rules.
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const layer = this.paths.layer(analysis.filePath);
        const issues: LintIssueDraft[] = [];
        if (
            analysis.filePath.endsWith('/interfaces.ts') &&
            /interface\s+[A-Za-z0-9_]*Store\b/u.test(analysis.source) &&
            analysis.anyTypeCount > 0
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'STORE_ANY_TYPE',
                    'Store contracts and implementations must not use any.',
                ),
            );
        }
        if (layer === 'store') {
            const genericMethod = analysis.classMethods.find((method) =>
                ['save', 'findById', 'findAll', 'delete', 'upsert'].includes(
                    method.name ?? '',
                ),
            );
            if (genericMethod) {
                issues.push(
                    this.issue(
                        analysis,
                        'STORE_GENERIC_METHOD',
                        `Store method '${genericMethod.name}' is too broad; declare a domain-specific method whose input carries its complete tenant and actor scope.`,
                    ),
                );
            }
            if (analysis.anyTypeCount > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'STORE_ANY_TYPE',
                        'Store contracts and implementations must not use any.',
                    ),
                );
            }
            if (
                analysis.constructorCalls.some(
                    (call) =>
                        call.className !== null &&
                        call.firstArgumentName !== null &&
                        /(row|result|record|data)/iu.test(
                            call.firstArgumentName,
                        ),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'STORE_QUERY_OBJECT_MAPPING',
                        'Database rows must be mapped explicitly before constructing Domain Objects.',
                    ),
                );
            }
            const requiredSource = [
                'id',
                'created_at',
                'updated_at',
                'is_deleted',
                'deleted_at',
            ];
            const requiredTarget = [
                'id',
                'createdAt',
                'updatedAt',
                'isDeleted',
                'deletedAt',
            ];
            for (const mapping of analysis.objectMappings) {
                const missing =
                    requiredSource.some(
                        (property) =>
                            !mapping.sourceProperties.includes(property),
                    ) ||
                    requiredTarget.some(
                        (property) =>
                            !mapping.targetProperties.includes(property),
                    );
                if (missing) {
                    issues.push(
                        this.issue(
                            analysis,
                            'STORE_OBJECT_METADATA_MAPPING',
                            'Row-to-Object mapping must explicitly map id, created_at, updated_at, is_deleted, and deleted_at to the corresponding Domain Object metadata fields.',
                        ),
                    );
                }
            }
            const deleteMethod = analysis.classMethods.find(
                (method) => method.name === 'delete',
            );
            if (
                deleteMethod &&
                (deleteMethod.calledMethods.includes('deleteFrom') ||
                    !['is_deleted', 'deleted_at', 'updated_at'].every(
                        (property) =>
                            deleteMethod.setProperties.includes(property),
                    ))
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'STORE_SOFT_DELETE_CONTRACT',
                        'delete() must soft-delete by updating is_deleted, deleted_at, and updated_at; deleteFrom() is forbidden.',
                    ),
                );
            }
            for (const method of analysis.classMethods.filter(
                (candidate) =>
                    candidate.name === 'findById' ||
                    candidate.name === 'findAll' ||
                    candidate.name?.startsWith('find'),
            )) {
                if (
                    !method.calledMethods.includes('where') ||
                    !method.stringArguments.includes('is_deleted')
                ) {
                    issues.push(
                        this.issue(
                            analysis,
                            'STORE_ACTIVE_READ_FILTER',
                            `${method.name ?? 'Finder'} must explicitly exclude soft-deleted rows with an is_deleted filter.`,
                        ),
                    );
                }
            }
        }

        if (
            layer === 'service' &&
            analysis.constructorCalls.some((call) =>
                call.className?.endsWith('Object'),
            ) &&
            analysis.persistenceCallOffsets.length > 0 &&
            (analysis.validationCallOffsets.length === 0 ||
                Math.min(...analysis.validationCallOffsets) >
                    Math.min(...analysis.persistenceCallOffsets))
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'OBJECT_VALIDATION_BEFORE_PERSIST',
                    'New Domain Objects must be validated before they are persisted.',
                ),
            );
        }
        return issues;
    }

    /** Checks BaseObject metadata on every declared database table. */
    public evaluateDatabaseSchema(): LintIssueDraft[] {
        const filePath = path.join(this.paths.sourceRoot(), 'database.ts');
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const source = fs.readFileSync(filePath, 'utf8');
        const externalTables = this.externalTableNames(source);
        const required = [
            'id',
            'created_at',
            'updated_at',
            'is_deleted',
            'deleted_at',
        ];
        const issues: LintIssueDraft[] = [];
        for (const match of source.matchAll(
            /interface\s+([A-Za-z0-9_]+Table)\s*\{([\s\S]*?)\}/gu,
        )) {
            const tableName = this.tableNameForInterface(source, match[1]);
            if (tableName && externalTables.has(tableName)) {
                continue;
            }
            const missing = required.filter(
                (field) => !new RegExp(`\\b${field}\\s*[?:]`, 'u').test(match[2]),
            );
            if (missing.length > 0) {
                issues.push({
                    ruleId: 'DATABASE_OBJECT_METADATA',
                    severity: 'error',
                    file: this.paths.relative(filePath),
                    message: `${match[1]} is missing BaseObject columns: ${missing.join(', ')}.`,
                });
            }
        }
        return issues;
    }

    /** Reads the explicit adapter ownership registry from the central schema. */
    private externalTableNames(source: string): ReadonlySet<string> {
        const registry = source.match(
            /export\s+const\s+EXTERNAL_TABLE_OWNERS\s*=\s*\{([\s\S]*?)\}\s+as\s+const/u,
        )?.[1];
        if (!registry) {
            return new Set();
        }
        return new Set(
            [...registry.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gmu)]
                .map((match) => match[1]),
        );
    }

    /** Resolves the Database property backed by one declared table interface. */
    private tableNameForInterface(
        source: string,
        interfaceName: string,
    ): string | null {
        const database = source.match(
            /export\s+interface\s+Database\s*\{([\s\S]*?)\}/u,
        )?.[1];
        if (!database) {
            return null;
        }
        const escaped = interfaceName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return database.match(
            new RegExp(`^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*:\\s*${escaped}\\s*;`, 'mu'),
        )?.[1] ?? null;
    }

    /** Creates one normalized issue. */
    private issue(
        analysis: SourceAnalysis,
        ruleId: string,
        message: string,
    ): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            message,
        };
    }
}
