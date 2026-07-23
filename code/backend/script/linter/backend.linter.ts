import { CompositionRuleSet } from './composition.rule-set.ts';
import { ContractRuleSet } from './contract.rule-set.ts';
import { CoverageRuleSet } from './coverage.rule-set.ts';
import { DependencyRuleSet } from './dependency.rule-set.ts';
import { DomainRuleSet } from './domain.rule-set.ts';
import { FileScanner } from './file.scanner.ts';
import { InfrastructureRuleSet } from './infrastructure.rule-set.ts';
import type {
    BackendLinterConfig,
    LintIssue,
    LintResult,
    SourceAnalysis,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { PersistenceRuleSet } from './persistence.rule-set.ts';
import { ProjectRuleSet } from './project.rule-set.ts';
import { SecurityRuleSet } from './security.rule-set.ts';
import { SourceAnalyzer } from './source.analyzer.ts';

/** Coordinates source discovery, analysis, and architecture rule evaluation. */
export class BackendLinter {
    private readonly paths: PathResolver;
    private readonly scanner = new FileScanner();
    private readonly analyzer = new SourceAnalyzer();
    private readonly domainRules: DomainRuleSet;
    private readonly compositionRules: CompositionRuleSet;
    private readonly infrastructureRules: InfrastructureRuleSet;
    private readonly projectRules: ProjectRuleSet;
    private readonly contractRules: ContractRuleSet;
    private readonly persistenceRules: PersistenceRuleSet;
    private readonly securityRules: SecurityRuleSet;
    private readonly dependencyRules: DependencyRuleSet;
    private readonly coverageRules: CoverageRuleSet;

    /** Creates a reusable linter core without output side effects. */
    constructor(config: BackendLinterConfig) {
        this.paths = new PathResolver(config.projectRoot);
        this.domainRules = new DomainRuleSet(this.paths);
        this.compositionRules = new CompositionRuleSet(this.paths);
        this.infrastructureRules = new InfrastructureRuleSet(this.paths);
        this.projectRules = new ProjectRuleSet(this.paths);
        this.contractRules = new ContractRuleSet(this.paths);
        this.persistenceRules = new PersistenceRuleSet(this.paths);
        this.securityRules = new SecurityRuleSet(this.paths);
        this.dependencyRules = new DependencyRuleSet(this.paths);
        this.coverageRules = new CoverageRuleSet(this.paths);
    }

    /** Analyzes the backend and returns deterministically sorted findings. */
    public run(): LintResult {
        const sourceFiles = this.scanner.listTypeScriptFiles(
            this.paths.sourceRoot(),
        );
        const issues = [
            ...this.moduleDirectoryIssues(),
            ...this.moduleRootFileIssues(),
            ...this.auxiliaryFileTypeIssues(),
            ...this.projectRules.evaluateStructure(),
            ...this.persistenceRules.evaluateDatabaseSchema(),
            ...this.dependencyRules.configurationIssues(),
            ...this.coverageRules.configurationIssues(),
        ];

        for (const filePath of sourceFiles) {
            const analysis = this.analyze(filePath, issues);
            if (!analysis) {
                continue;
            }

            issues.push(...this.infrastructureRules.evaluate(analysis));
            if (this.paths.moduleName(filePath)) {
                issues.push(...this.domainRules.evaluate(analysis));
                issues.push(...this.projectRules.evaluateSource(analysis));
                issues.push(...this.contractRules.evaluate(analysis));
                issues.push(...this.persistenceRules.evaluate(analysis));
                issues.push(...this.securityRules.evaluate(analysis));
                issues.push(...this.dependencyRules.evaluate(analysis));
                issues.push(...this.coverageRules.evaluate(analysis));
            }
            if (this.paths.isCompositionFile(filePath)) {
                issues.push(...this.compositionRules.evaluate(analysis));
            }
        }

        return {
            issues: this.sortIssues(issues),
            filesChecked: sourceFiles.length,
        };
    }

    /** Converts parser failures into fatal lint findings. */
    private analyze(
        filePath: string,
        issues: LintIssue[],
    ): SourceAnalysis | null {
        try {
            return this.analyzer.analyze(filePath);
        } catch (error: unknown) {
            issues.push({
                ruleId: 'SOURCE_PARSE_ERROR',
                severity: 'fatal',
                file: this.paths.relative(filePath),
                message:
                    error instanceof Error
                        ? error.message
                        : 'Unknown parser failure',
            });
            return null;
        }
    }

    /** Rejects the plural source directory even when it contains no files. */
    private moduleDirectoryIssues(): LintIssue[] {
        const pluralModuleRoot = this.paths.pluralModuleRoot();
        if (!this.scanner.directoryExists(pluralModuleRoot)) {
            return [];
        }

        return [
            {
                ruleId: 'MODULE_DIRECTORY_NAME',
                severity: 'error',
                file: this.paths.relative(pluralModuleRoot),
                message:
                    'Backend modules must be placed in ' +
                    'code/backend/src/module/<name>/; ' +
                    'code/backend/src/modules/ is forbidden.',
            },
        ];
    }

    /** Rejects files of every type placed directly in the module root. */
    private moduleRootFileIssues(): LintIssue[] {
        return this.scanner
            .listDirectFiles(this.paths.moduleRoot())
            .map((filePath) => ({
                ruleId: 'MODULE_ROOT_FILE',
                severity: 'error' as const,
                file: this.paths.relative(filePath),
                message: 'Files may not be placed directly in src/module/.',
            }));
    }

    /** Rejects non-TypeScript files inside auxiliary or deeper folders. */
    private auxiliaryFileTypeIssues(): LintIssue[] {
        return this.scanner
            .listFiles(this.paths.moduleRoot())
            .filter(
                (filePath) =>
                    (this.paths.modulePathDepth(filePath) ?? 0) >= 3 &&
                    !filePath.endsWith('.ts'),
            )
            .map((filePath) => ({
                ruleId: 'AUX_FILE_TYPE',
                severity: 'error' as const,
                file: this.paths.relative(filePath),
                message: 'Auxiliary folders may contain TypeScript files only.',
            }));
    }

    /** Sorts diagnostics independently from filesystem traversal order. */
    private sortIssues(issues: LintIssue[]): LintIssue[] {
        return [...issues].sort((left, right) => {
            return (
                left.file.localeCompare(right.file) ||
                left.ruleId.localeCompare(right.ruleId) ||
                left.message.localeCompare(right.message)
            );
        });
    }
}
