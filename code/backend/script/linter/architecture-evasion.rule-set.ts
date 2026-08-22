import path from 'node:path';
import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Rejects module contracts and wiring patterns that bypass typed composition. */
export class ArchitectureEvasionRuleSet {
    private readonly paths: PathResolver;

    /** Creates the rule set for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates rules that can be decided from one domain source file. */
    // fallow-ignore-next-line complexity -- Dispatches independent module contract rules.
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        if (
            analysis.anyTypeCount > 0 ||
            analysis.anyAssertionCount > 0 ||
            analysis.doubleAssertionCount > 0
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'DOMAIN_ANY_TYPE',
                    'Domain modules must not use any, as any, or chained type assertions.',
                ),
            );
        }
        if (
            analysis.filePath.endsWith('/interfaces.ts') &&
            analysis.interfaceBaseNames.includes('BaseModule')
        ) {
            issues.push(
                this.issue(
                    analysis,
                    'MODULE_PORT_CONCRETE_BASE',
                    'Public module ports must use IBaseModule or an explicit typed node dispatch contract; they must not extend BaseModule.',
                ),
            );
        }
        for (const request of analysis.typeAliasOperationKinds) {
            if (
                request.operationUnionInsideMember ||
                request.payloadUnionInsideMember ||
                (request.unionMemberCount > 1 &&
                    request.operationLiteralCount !== request.unionMemberCount)
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'NODE_REQUEST_DISCRIMINATION',
                        `${request.aliasName ?? 'Node request'} must be a union of complete request objects, each with one literal operation and its matching payload.`,
                    ),
                );
            }
        }
        if (path.basename(analysis.filePath) === 'index.ts') {
            const moduleClass = analysis.classes.find((candidate) =>
                candidate.name?.endsWith('Module'),
            );
            if (
                moduleClass?.methodNames.some((name) =>
                    /^(?:set|attach|wire|connect|register)[A-Z_]/u.test(name),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'MODULE_POST_CONSTRUCTION_WIRING',
                        'A module must be fully wired by its factory and constructor; post-construction setters and registration methods are forbidden.',
                    ),
                );
            }
            const required = ['name', 'dependencies', 'create'];
            if (
                analysis.ownedModuleDefinitionCount !== 1 ||
                analysis.ownedModuleDefinitionHasSpread ||
                required.some(
                    (property) =>
                        !analysis.ownedModuleDefinitionProperties.includes(
                            property,
                        ),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'MODULE_DEFINITION_OWNERSHIP',
                        'The module class must directly own one static definition object containing name, dependencies, and create; spreads and external metadata objects are forbidden.',
                    ),
                );
            }
            if (
                analysis.anyTypeCount > 0 ||
                (/\binfrastructure\b/u.test(analysis.source) &&
                    !analysis.source.includes('ApplicationInfrastructure'))
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'MODULE_INFRASTRUCTURE_CONTRACT',
                        'Module factories must use the central ApplicationInfrastructure contract without local infrastructure shapes or additional properties.',
                    ),
                );
            }
        }
        return issues;
    }

    /** Verifies that every concrete handler is constructed and registered. */
    // fallow-ignore-next-line complexity -- Relates module handlers to constructor registrations.
    public evaluateFactoryCompleteness(
        analyses: readonly SourceAnalysis[],
    ): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const moduleNames = new Set(
            analyses
                .map((analysis) => this.paths.moduleName(analysis.filePath))
                .filter((name): name is string => Boolean(name)),
        );
        for (const moduleName of moduleNames) {
            const moduleAnalyses = analyses.filter(
                (analysis) =>
                    this.paths.moduleName(analysis.filePath) === moduleName,
            );
            const entry = moduleAnalyses.find((analysis) =>
                analysis.filePath.endsWith(`/${moduleName}/index.ts`),
            );
            if (!entry) {
                continue;
            }
            const registrations = new Map(
                entry.handlerRegistrations.map((registration) => [
                    registration.handlerClass,
                    registration.transport,
                ]),
            );
            for (const handler of moduleAnalyses.filter(
                (analysis) =>
                    this.paths.layer(analysis.filePath) === 'api' &&
                    !this.paths.auxiliaryPath(analysis.filePath),
            )) {
                const handlerClass = handler.classes[0];
                if (
                    !handlerClass ||
                    handlerClass.baseName === 'BaseHandler' ||
                    handlerClass.methodNames.length === 0
                ) {
                    continue;
                }
                const expectedTransport = this.transport(handler.filePath);
                if (
                    registrations.get(handlerClass.name) !== expectedTransport
                ) {
                    issues.push(
                        this.issue(
                            entry,
                            'MODULE_FACTORY_COMPLETENESS',
                            `${handlerClass.name ?? 'Concrete handler'} must be constructed and registered as '${expectedTransport}' before the module factory returns.`,
                        ),
                    );
                }
            }
        }
        return issues;
    }

    /** Returns the transport encoded in a handler filename. */
    private transport(filePath: string): string {
        if (filePath.endsWith('.websocket.handler.ts')) {
            return 'websocket';
        }
        if (filePath.endsWith('.cli.handler.ts')) {
            return 'cli';
        }
        if (filePath.endsWith('.node.handler.ts')) {
            return 'node';
        }
        return 'http';
    }

    /** Creates one normalized architecture finding. */
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
