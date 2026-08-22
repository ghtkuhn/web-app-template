import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Restricts composition roots to public module entry points. */
export class CompositionRuleSet {
    private readonly paths: PathResolver;

    /** Creates composition rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates imports and re-exports in one composition source file. */
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        return [
            ...this.publicEntryIssues(analysis),
            ...this.catalogAggregationIssues(analysis),
            ...this.genericityIssues(analysis),
        ];
    }

    /** Keeps composition generic and prevents duck-typed module rewiring. */
    // fallow-ignore-next-line complexity -- Evaluates two independent composition bypass patterns.
    private genericityIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const domainImport =
            !analysis.filePath.endsWith('module.catalog.ts') &&
            analysis.dependencies.find((dependency) => {
                const target = this.paths.resolveDependency(
                    analysis.filePath,
                    dependency.source,
                );
                return target !== null && this.paths.moduleName(target) !== null;
            });
        const rewiring = analysis.methodCallEvidence.find((entry) =>
            /^(?:setInfrastructure|setHandlers|attachHandler|wireHandlers|registerHandler)$/u.test(
                entry.name,
            ),
        );
        if (!domainImport && !rewiring) {
            return [];
        }
        const issues: LintIssueDraft[] = [];
        if (domainImport) {
            issues.push({
                ruleId: 'COMPOSITION_GENERICITY',
                severity: 'error',
                file: this.paths.relative(analysis.filePath),
                observed:
                    'Composition must remain domain-agnostic; individual module entry points are owned by module.catalog.ts.',
                location: domainImport.location,
            });
        }
        if (rewiring) {
            issues.push({
                ruleId: 'MODULE_POST_CONSTRUCTION_WIRING',
                severity: 'error',
                file: this.paths.relative(analysis.filePath),
                observed:
                    'Composition must not mutate or duck-type module instances after ModuleRegistry construction.',
                location: rewiring.location,
            });
        }
        return issues;
    }

    /** Restricts composition dependencies to public module entry points. */
    private publicEntryIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        for (const dependency of analysis.dependencies) {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            if (
                target &&
                this.paths.moduleName(target) &&
                !this.paths.isPublicModuleEntry(target)
            ) {
                issues.push({
                    ruleId: 'COMPOSITION_PUBLIC_ENTRY',
                    severity: 'error',
                    file: this.paths.relative(analysis.filePath),
                    observed: `Composition code must import modules through index.ts, not ${dependency.source}.`,
                    location: dependency.location,
                });
            }
        }
        return issues;
    }

    /** Prevents generated catalogs from owning factories or dependencies. */
    private catalogAggregationIssues(
        analysis: SourceAnalysis,
    ): LintIssueDraft[] {
        if (
            !analysis.filePath.endsWith('module.catalog.ts') ||
            !/\b(?:dependencies|create)\s*:/.test(analysis.source)
        ) {
            return [];
        }
        return [{
            ruleId: 'CATALOG_AGGREGATION_ONLY',
            severity: 'error',
            file: this.paths.relative(analysis.filePath),
            observed: 'The generated module catalog may aggregate module-owned definitions only.',
        }];
    }
}
