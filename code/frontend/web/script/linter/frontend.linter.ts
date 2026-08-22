import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureRuleSet } from './architecture.rule-set.ts';
import { FileScanner } from './file.scanner.ts';
import type {
    LintIssue,
    LintIssueDraft,
    LintResult,
    SourceSpan,
    SourceAnalysis,
} from './interfaces.ts';
import { PathResolver, type PresentationName } from './path.resolver.ts';
import { SourceAnalyzer } from './source.analyzer.ts';
import { StyleRuleSet } from './style.rule-set.ts';
import { RuleCatalog } from './rule.catalog.ts';

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
    private readonly catalog = new RuleCatalog();

    constructor(projectRoot: string) {
        this.paths = new PathResolver(projectRoot);
        this.rules = new ArchitectureRuleSet(this.paths);
        this.styleRules = new StyleRuleSet(this.paths);
    }

    public run(): LintResult {
        const files = this.scanner.list(this.paths.sourceRoot());
        const analyses: SourceAnalysis[] = [];
        const drafts: LintIssueDraft[] = [];
        for (const filePath of files) {
            try {
                const analysis = this.analyzer.analyze(filePath);
                analyses.push(analysis);
                drafts.push(...this.rules.evaluate(analysis));
            } catch (error: unknown) {
                drafts.push({
                    ruleId: 'FRONTEND_PARSE_ERROR',
                    severity: 'fatal',
                    file: this.paths.relative(filePath),
                    observed:
                        error instanceof Error
                            ? error.message
                            : 'Unknown parser failure',
                    location: this.errorLocation(error),
                });
            }
        }
        drafts.push(...this.styleRules.evaluate(analyses));
        drafts.push(...this.parityIssues(analyses));
        const issues = drafts.map((draft) => this.catalog.create(draft));
        return {
            filesChecked: files.length,
            issues: this.sort(issues),
        };
    }

    private parityIssues(
        analyses: readonly SourceAnalysis[],
    ): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
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
                        observed: `${key} is missing for ${missing.join(', ')}.`,
                        location: null,
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
                left.observed.localeCompare(right.observed),
        );
    }

    private errorLocation(error: unknown): SourceSpan | null {
        if (!error || typeof error !== 'object') {
            return null;
        }
        const candidate = error as {
            loc?: {
                line?: number;
                column?: number;
                start?: { line?: number; column?: number };
            };
        };
        const location = candidate.loc?.start ?? candidate.loc;
        if (!location?.line) {
            return null;
        }
        const column = Math.max(1, (location.column ?? 0) + 1);
        return {
            start: { line: location.line, column },
            end: { line: location.line, column: column + 1 },
        };
    }
}
