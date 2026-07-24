import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces centralized configuration and safe Domain Object serialization. */
export class SecurityRuleSet {
    private readonly paths: PathResolver;

    /** Creates security rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates security rules for one domain source file. */
    // fallow-ignore-next-line complexity -- Applies independent, fixture-tested security checks.
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        if (analysis.environmentAccessCount > 0) {
            issues.push(
                this.issue(
                    analysis,
                    'DOMAIN_ENV_ACCESS',
                    'Domain modules must receive validated configuration and may not read process.env.',
                ),
            );
        }
        if (
            /\b(secret|password|token)[A-Za-z0-9_]*\s*=\s*process\.env[\s\S]{0,120}(\|\||\?\?)/iu.test(
                analysis.source,
            ) ||
            /\b(dev-secret|change-me|development-secret)\b/iu.test(
                analysis.source,
            )
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'SECRET_FALLBACK',
                    'Secrets must not use a development or hard-coded fallback.',
                ),
            );
        }

        if (this.paths.layer(analysis.filePath) === 'object') {
            const sensitive = analysis.classes.some((classAnalysis) =>
                classAnalysis.propertyNames.some((property) =>
                    /(password|hash|secret|token)/iu.test(property),
                ),
            );
            const overridesSerialization = analysis.classes.some(
                (classAnalysis) =>
                    classAnalysis.methodNames.includes('toJSON'),
            );
            if (sensitive && !overridesSerialization) {
                issues.push(
                    this.issue(
                        analysis,
                        'SENSITIVE_OBJECT_SERIALIZATION',
                        'Domain Objects with sensitive fields must explicitly provide safe serialization.',
                    ),
                );
            }
        }
        return issues;
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
