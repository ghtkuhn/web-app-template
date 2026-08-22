import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
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
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const layer = this.paths.layer(analysis.filePath);
        const issues: LintIssueDraft[] = [];
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
                analysis.handlerResultPayloadNames.some((payload) =>
                    [
                        'BaseDTO',
                        'Object',
                        'TSObjectKeyword',
                        'TSUnionType',
                    ].includes(payload ?? ''),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_CONCRETE_DTO_CONTRACT',
                        'The Handler success contract does not name one concrete business Response DTO.',
                    ),
                );
            }
            if (
                analysis.handlerResultPayloadNames.some(
                    (payload) => payload === null,
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_OUTPUT',
                        'The HandlerResult does not declare a concrete Response DTO.',
                    ),
                );
            }
            if (
                analysis.handlerResultPayloadNames.some(
                    (payload) =>
                        payload !== null && !payload.endsWith('DTO'),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HANDLER_DTO_OUTPUT',
                        'The HandlerResult payload uses a base, anonymous, or otherwise non-concrete contract.',
                    ),
                );
            }
            if (
                analysis.handlerResultPayloadNames.some((payload) =>
                    payload?.endsWith('Object'),
                ) ||
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
            analysis.executableConstantCount > 0
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'CONSTANT_EXECUTABLE_VALUE',
                    'constants.ts may contain passive values only; functions, methods, classes, calls, constructors, and mutations are forbidden.',
                ),
            );
        }
        return issues;
    }

    /** Creates one normalized issue. */
    // fallow-ignore-next-line code-duplication -- Stable issue construction mirrors the established infrastructure rules.
    private issue(
        analysis: SourceAnalysis,
        ruleId: LintIssueDraft['ruleId'],
        observed: string,
    ): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            observed,
        };
    }
}
