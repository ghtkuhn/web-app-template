import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces validated DTO boundaries and Node-compatible TypeScript syntax. */
export class TransportRuleSet {
    private readonly paths: PathResolver;

    /** Creates transport rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates one domain source file. */
    // fallow-ignore-next-line complexity -- Evaluates independent transport and syntax contracts.
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const layer = this.paths.layer(analysis.filePath);
        if (layer === 'api') {
            if (analysis.dtoCastFromJsonCount > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_CAST_BYPASS',
                        'A type assertion does not validate request.json() data. Fix: construct a concrete request DTO or call a typed validator that returns that DTO before invoking the Controller.',
                    ),
                );
            }
            const unvalidated = analysis.jsonResultVariables.filter(
                (name) =>
                    analysis.controllerPayloadVariables.includes(name) &&
                    !analysis.dtoResultVariables.includes(name),
            );
            if (unvalidated.length > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_UNVALIDATED_INPUT',
                        `request.json() data (${unvalidated.join(', ')}) must be converted to a declared request DTO or validated before reaching a Controller or Service. Fix: construct the request DTO or use a typed validator; do not cast the JSON value.`,
                    ),
                );
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_INPUT',
                        'HTTP and Node business payloads must cross the Handler boundary as request DTOs. Fix: pass the concrete request DTO returned by construction or validation.',
                    ),
                );
            }
        }
        if (
            layer === 'dto' &&
            analysis.classes.some(
                (candidate) => candidate.staticExecutablePropertyCount > 0,
            )
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'DTO_EXECUTABLE_LOGIC',
                    'DTOs are passive transport contracts; validator instances, schemas, and executable static initialization belong in Services or Service Aux classes.',
                ),
            );
        }
        if (analysis.nonErasableSyntaxCount > 0) {
            issues.push(
                this.issue(
                    analysis,
                    'NODE_ERASABLE_TYPES_ONLY',
                    'Executable backend TypeScript must use erasable syntax only; parameter properties, enums, namespaces, import-equals, and export-assignment are forbidden.',
                ),
            );
        }
        return issues;
    }

    /** Evaluates backend tests for type escapes and non-erasable syntax. */
    // fallow-ignore-next-line complexity -- Evaluates two independent test contracts.
    public evaluateTests(tests: readonly SourceAnalysis[]): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        for (const test of tests) {
            if (
                test.anyTypeCount > 0 ||
                test.anyAssertionCount > 0 ||
                test.doubleAssertionCount > 0
            ) {
                issues.push(
                    this.issue(
                        test,
                        'TEST_TYPE_ESCAPE',
                        'Backend tests must not use any or chained assertions to bypass contracts; use typed fixtures and @ts-expect-error for negative type tests.',
                    ),
                );
            }
            if (test.nonErasableSyntaxCount > 0) {
                issues.push(
                    this.issue(
                        test,
                        'NODE_ERASABLE_TYPES_ONLY',
                        'Backend tests must use TypeScript syntax supported by Node strip-only execution.',
                    ),
                );
            }
        }
        return issues;
    }

    /** Creates one normalized finding. */
    // fallow-ignore-next-line code-duplication -- Rule sets intentionally use identical stable finding construction.
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
