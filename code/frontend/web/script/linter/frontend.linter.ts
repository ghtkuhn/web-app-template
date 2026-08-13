import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureRuleSet } from './architecture.rule-set.ts';
import { FileScanner } from './file.scanner.ts';
import type {
    LintIssue,
    LintResult,
    SourceAnalysis,
} from './interfaces.ts';
import { PathResolver, type PresentationName } from './path.resolver.ts';
import { SourceAnalyzer } from './source.analyzer.ts';
import { StyleRuleSet } from './style.rule-set.ts';

const PRESENTATIONS: readonly PresentationName[] = [
    'desktop',
    'tablet',
    'mobile',
];

/** Coordinates deterministic Vue and TypeScript architecture analysis. */
export class FrontendLinter {
    private readonly paths: PathResolver;
    private readonly scanner = new FileScanner();
    private readonly analyzer = new SourceAnalyzer();
    private readonly rules: ArchitectureRuleSet;
    private readonly styleRules: StyleRuleSet;

    constructor(projectRoot: string) {
        this.paths = new PathResolver(projectRoot);
        this.rules = new ArchitectureRuleSet(this.paths);
        this.styleRules = new StyleRuleSet(this.paths);
    }

    public run(): LintResult {
        const files = this.scanner.list(this.paths.sourceRoot());
        const analyses: SourceAnalysis[] = [];
        const issues: LintIssue[] = [];
        for (const filePath of files) {
            try {
                const analysis = this.analyzer.analyze(filePath);
                analyses.push(analysis);
                issues.push(...this.rules.evaluate(analysis));
            } catch (error: unknown) {
                issues.push({
                    ruleId: 'FRONTEND_PARSE_ERROR',
                    severity: 'fatal',
                    file: this.paths.relative(filePath),
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown parser failure',
                });
            }
        }
        issues.push(...this.styleRules.evaluate(analyses));
        issues.push(...this.parityIssues(analyses));
        return {
            filesChecked: files.length,
            issues: this.sort(issues),
        };
    }

    private parityIssues(analyses: readonly SourceAnalysis[]): LintIssue[] {
        const issues: LintIssue[] = [];
        const candidates = analyses.filter((analysis) => {
            const segments = this.paths.segments(analysis.filePath);
            return (
                this.paths.presentation(analysis.filePath) !== null &&
                ['views', 'layouts'].includes(segments[2])
            );
        });
        const keys = new Set(
            candidates.map((analysis) => {
                const segments = this.paths.segments(analysis.filePath);
                return `${segments[2]}/${segments[3]}`;
            }),
        );
        for (const key of keys) {
            const missing = PRESENTATIONS.filter(
                (presentation) =>
                    !fs.existsSync(
                        path.join(
                            this.paths.sourceRoot(),
                            'presentation',
                            presentation,
                            key,
                        ),
                    ),
            );
            if (missing.length > 0) {
                const source = candidates.find((analysis) => {
                    const segments = this.paths.segments(analysis.filePath);
                    return `${segments[2]}/${segments[3]}` === key;
                });
                if (source) {
                    issues.push({
                        ruleId: 'PRESENTATION_VIEW_PARITY',
                        severity: 'error',
                        file: this.paths.relative(source.filePath),
                        message: `${key} is missing for ${missing.join(', ')}.`,
                    });
                }
            }
        }
        return issues;
    }

    private sort(issues: readonly LintIssue[]): LintIssue[] {
        return [...issues].sort(
            (left, right) =>
                left.file.localeCompare(right.file) ||
                left.ruleId.localeCompare(right.ruleId) ||
                left.message.localeCompare(right.message),
        );
    }
}
