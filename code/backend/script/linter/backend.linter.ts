import { CompositionRuleSet } from './composition.rule-set.ts';
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
import { SourceAnalyzer } from './source.analyzer.ts';

/** Coordinates source discovery, analysis, and architecture rule evaluation. */
export class BackendLinter {
    private readonly paths: PathResolver;
    private readonly scanner = new FileScanner();
    private readonly analyzer = new SourceAnalyzer();
    private readonly domainRules: DomainRuleSet;
    private readonly compositionRules: CompositionRuleSet;
    private readonly infrastructureRules: InfrastructureRuleSet;

    /** Creates a reusable linter core without output side effects. */
    constructor(config: BackendLinterConfig) {
        this.paths = new PathResolver(config.projectRoot);
        this.domainRules = new DomainRuleSet(this.paths);
        this.compositionRules = new CompositionRuleSet(this.paths);
        this.infrastructureRules = new InfrastructureRuleSet(this.paths);
    }

    /** Analyzes the backend and returns deterministically sorted findings. */
    public run(): LintResult {
        const sourceFiles = this.scanner.listTypeScriptFiles(
            this.paths.sourceRoot(),
        );
        const issues = [
            ...this.moduleRootFileIssues(),
            ...this.auxiliaryFileTypeIssues(),
        ];

        for (const filePath of sourceFiles) {
            const analysis = this.analyze(filePath, issues);
            if (!analysis) {
                continue;
            }

            issues.push(...this.infrastructureRules.evaluate(analysis));
            if (this.paths.moduleName(filePath)) {
                issues.push(...this.domainRules.evaluate(analysis));
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
