import { CompositionRuleSet } from './composition.rule-set.ts';
import { ContractRuleSet } from './contract.rule-set.ts';
import { CoverageRuleSet } from './coverage.rule-set.ts';
import { DependencyRuleSet } from './dependency.rule-set.ts';
import { DiagnosticFactory } from './diagnostic.factory.ts';
import { DomainRuleSet } from './domain.rule-set.ts';
import { FileScanner } from './file.scanner.ts';
import { InfrastructureRuleSet } from './infrastructure.rule-set.ts';
import { ModuleTestRuleSet } from './module-test.rule-set.ts';
import type {
    BackendLinterConfig,
    LintIssue,
    LintIssueDraft,
    LintResult,
    SourceAnalysis,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { PersistenceRuleSet } from './persistence.rule-set.ts';
import { ProjectRuleSet } from './project.rule-set.ts';
import { ProjectModel } from './project.model.ts';
import { SecurityRuleSet } from './security.rule-set.ts';
import { ServiceOperationRuleSet } from './service-operation.rule-set.ts';
import { SourceAnalyzer } from './source.analyzer.ts';
import { TransportRuleSet } from './transport.rule-set.ts';
import { WorkspaceRuleSet } from './workspace.rule-set.ts';

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
    private readonly architectureEvasionRules: ArchitectureEvasionRuleSet;
    private readonly transportRules: TransportRuleSet;
    private readonly workspaceRules: WorkspaceRuleSet;
    private readonly moduleTestRules: ModuleTestRuleSet;
    private readonly serviceOperationRules: ServiceOperationRuleSet;
    private readonly project: ProjectModel;

    /** Creates a reusable linter core without output side effects. */
    constructor(config: BackendLinterConfig) {
        this.paths = new PathResolver(config.projectRoot);
        this.project = new ProjectModel(this.paths);
        this.domainRules = new DomainRuleSet(this.paths);
        this.compositionRules = new CompositionRuleSet(this.paths);
        this.infrastructureRules = new InfrastructureRuleSet(this.paths);
        this.projectRules = new ProjectRuleSet(this.paths);
        this.contractRules = new ContractRuleSet(this.paths);
        this.persistenceRules = new PersistenceRuleSet(this.paths);
        this.securityRules = new SecurityRuleSet(this.paths);
        this.dependencyRules = new DependencyRuleSet(this.paths);
        this.coverageRules = new CoverageRuleSet(this.paths, this.project);
        this.architectureEvasionRules = new ArchitectureEvasionRuleSet(
            this.paths,
        );
        this.transportRules = new TransportRuleSet(this.paths);
        this.workspaceRules = new WorkspaceRuleSet(
            this.paths,
            this.project,
        );
        this.moduleTestRules = new ModuleTestRuleSet(this.paths);
        this.serviceOperationRules = new ServiceOperationRuleSet(this.paths);
    }

    /** Analyzes the backend and returns deterministically sorted findings. */
    public run(): LintResult {
        const discoveredSourceFiles = this.scanner.listTypeScriptFiles(
            this.paths.sourceRoot(),
        );
        const sourceFiles = discoveredSourceFiles.filter(
            (filePath) => !this.paths.isModuleTestPath(filePath),
        );
        const testAnalyses = this.project.testAnalyses();
        const issues = [
            ...this.moduleDirectoryIssues(),
            ...this.moduleRootFileIssues(),
            ...this.auxiliaryFileTypeIssues(),
            ...this.projectRules.evaluateStructure(),
            ...this.persistenceRules.evaluateDatabaseSchema(),
            ...this.dependencyRules.configurationIssues(),
            ...this.coverageRules.configurationIssues(),
            ...this.workspaceConfigurationIssues(),
            ...this.moduleTestRules.configurationIssues(),
        ];
        const analyses: SourceAnalysis[] = [];

        for (const filePath of sourceFiles) {
            const analysis = this.analyze(filePath, issues);
            if (!analysis) {
                continue;
            }
            analyses.push(analysis);

            issues.push(...this.infrastructureRules.evaluate(analysis));
            if (this.paths.moduleName(filePath)) {
                issues.push(...this.domainRules.evaluate(analysis));
                issues.push(...this.projectRules.evaluateSource(analysis));
                issues.push(...this.contractRules.evaluate(analysis));
                issues.push(...this.persistenceRules.evaluate(analysis));
                issues.push(...this.securityRules.evaluate(analysis));
                issues.push(...this.dependencyRules.evaluate(analysis));
                issues.push(...this.coverageRules.evaluate(analysis));
                issues.push(
                    ...this.architectureEvasionRules.evaluate(analysis),
                );
                issues.push(...this.transportRules.evaluate(analysis));
                issues.push(...this.serviceOperationRules.evaluate(analysis));
                issues.push(
                    ...this.serviceOperationRules.legacyIssues(analysis),
                );
                issues.push(...this.moduleTestRules.evaluateProduction(analysis));
            }
            if (this.paths.isCompositionFile(filePath)) {
                issues.push(...this.compositionRules.evaluate(analysis));
            }
        }
        issues.push(
            ...this.architectureEvasionRules.evaluateFactoryCompleteness(
                analyses,
            ),
            ...this.transportRules.evaluateTests(testAnalyses),
            ...testAnalyses.flatMap((analysis) =>
                this.paths.isModuleTestFile(analysis.filePath)
                    ? this.moduleTestRules.evaluateTest(analysis)
                    : [],
            ),
            ...this.moduleTestRules.coverageIssues(analyses, testAnalyses),
        );

        const factory = new DiagnosticFactory(this.paths, [
            ...analyses,
            ...testAnalyses,
        ]);
        return {
            issues: this.sortIssues(
                issues.map((issue) => factory.create(issue)),
            ),
            filesChecked: sourceFiles.length + testAnalyses.length,
        };
    }

    /** Converts malformed workspace metadata into an existing fatal finding. */
    private workspaceConfigurationIssues(): LintIssueDraft[] {
        try {
            return this.workspaceRules.evaluate();
        } catch {
            return [];
        }
    }

    /** Converts parser failures into fatal lint findings. */
    private analyze(
        filePath: string,
        issues: LintIssueDraft[],
    ): SourceAnalysis | null {
        try {
            return this.analyzer.analyze(filePath);
        } catch (error: unknown) {
            const parserLocation =
                error && typeof error === 'object'
                    ? (
                          error as {
                              loc?: { line?: number; column?: number };
                          }
                      ).loc
                    : undefined;
            const line = parserLocation?.line ?? 1;
            const column = (parserLocation?.column ?? 0) + 1;
            issues.push({
                ruleId: 'SOURCE_PARSE_ERROR',
                severity: 'fatal',
                file: this.paths.relative(filePath),
                message:
                    error instanceof Error
                        ? error.message
                        : 'Unknown parser failure',
                location: {
                    start: { line, column },
                    end: { line, column },
                },
            });
            return null;
        }
    }

    /** Rejects the plural source directory even when it contains no files. */
    private moduleDirectoryIssues(): LintIssueDraft[] {
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
    private moduleRootFileIssues(): LintIssueDraft[] {
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
    private auxiliaryFileTypeIssues(): LintIssueDraft[] {
        return this.scanner
            .listFiles(this.paths.moduleRoot())
            .filter(
                (filePath) =>
                    (this.paths.modulePathDepth(filePath) ?? 0) >= 3 &&
                    !this.paths.isModuleTestPath(filePath) &&
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
                left.location.start.line - right.location.start.line ||
                left.location.start.column - right.location.start.column ||
                left.ruleId.localeCompare(right.ruleId) ||
                left.reason.localeCompare(right.reason)
            );
        });
    }
}
import { ArchitectureEvasionRuleSet } from './architecture-evasion.rule-set.ts';
