import type { LintIssue, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces transport-neutral controllers and DTO-based public contracts. */
export class ContractRuleSet {
    // fallow-ignore-next-line code-duplication -- Rule sets intentionally share the same lifecycle shape.
    private readonly paths: PathResolver;

    /** Creates contract rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates public contract rules for one domain source file. */
    // fallow-ignore-next-line complexity -- Declarative dispatcher for independently tested contract rules.
    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        const layer = this.paths.layer(analysis.filePath);
        const issues: LintIssue[] = [];
        if (layer === 'controller') {
            if (
                analysis.requestBodyAccessCount > 0 ||
                analysis.parameterNames.some((name) =>
                    ['req', 'res', 'request', 'response'].includes(
                        name.toLowerCase(),
                    ),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'CONTROLLER_TRANSPORT_INPUT',
                        'Controllers must receive transport-neutral DTOs, not request or response objects.',
                    ),
                );
            }
            if (analysis.catchCount > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'CONTROLLER_ERROR_TRANSLATION',
                        'Controllers must not translate arbitrary exceptions into transport errors.',
                    ),
                );
            }
            if (analysis.throwMessageAccessCount > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'RAW_ERROR_RESPONSE',
                        'Raw exception messages must not be exposed by controllers.',
                    ),
                );
            }
            if (analysis.objectReturnCount > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'ANONYMOUS_RESPONSE_CONTRACT',
                        'Controller responses must use declared DTO contracts.',
                    ),
                );
                if (/this\.[A-Za-z0-9_]*service\./iu.test(analysis.source)) {
                    issues.push(
                        this.issue(
                            analysis,
                            'LAYER_RETURN_CONTRACT',
                            'Controllers must preserve the declared service result contract.',
                        ),
                    );
                }
            }
            if (
                /HandlerResult\s*<\s*(?![A-Za-z0-9_]*DTO\b)[A-Za-z0-9_]+/u.test(
                    analysis.source,
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'CONTROLLER_DTO_CONTRACT',
                        'Controller HandlerResult payloads must be DTO classes.',
                    ),
                );
            }
        }

        if (layer === 'api') {
            if (
                /\bHandlerResult\b(?!\s*<)/u.test(
                    analysis.source.replace(
                        /import\s+type\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];?/gu,
                        '',
                    ),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_OUTPUT',
                        'Handlers must declare the DTO carried by HandlerResult.',
                    ),
                );
            }
            if (
                /HandlerResult\s*<\s*(?![A-Za-z0-9_]*DTO\b)[A-Za-z0-9_]+/u.test(
                    analysis.source,
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_OUTPUT',
                        'HandlerResult payloads must use DTO classes.',
                    ),
                );
            }
            if (
                /HandlerResult\s*<[^>]*Object/u.test(analysis.source) ||
                /from\s+['"][^'"]*\/object\//u.test(analysis.source)
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'DOMAIN_OBJECT_TRANSPORT',
                        'Handlers must not expose Domain Objects directly.',
                    ),
                );
            }
        }

        if (analysis.unknownCastCount > 0) {
            issues.push(
                this.issue(
                    analysis,
                    'DOMAIN_ARCHITECTURE_CAST',
                    'Domain code must not bypass architecture types through unknown casts.',
                ),
            );
        }
        if (
            analysis.filePath.endsWith('/constants.ts') &&
            (/\bnew\s+[A-Za-z_$]/u.test(analysis.source) ||
                analysis.dependencies.some((dependency) =>
                    ['zod', 'joi', 'yup'].includes(dependency.source),
                ))
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'CONSTANT_EXECUTABLE_VALUE',
                    'constants.ts may contain passive values only, not executable validators.',
                ),
            );
        }
        return issues;
    }

    /** Creates one normalized issue. */
    // fallow-ignore-next-line code-duplication -- Stable issue construction mirrors the established infrastructure rules.
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
