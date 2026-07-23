import path from 'node:path';
import fs from 'node:fs';
import type { LintIssue, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Enforces declaration, inheritance, layering, and module-boundary rules. */
export class DomainRuleSet {
    private readonly paths: PathResolver;

    /** Creates domain rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Evaluates every applicable domain rule for one module source file. */
    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        return [
            ...this.declarationIssues(analysis),
            ...this.auxiliaryPathIssues(analysis),
            ...this.classIssues(analysis),
            ...this.layerImportIssues(analysis),
            ...this.auxiliaryImportIssues(analysis),
            ...this.moduleBoundaryIssues(analysis),
            ...this.controllerMappingIssues(analysis),
        ];
    }

    /** Checks declaration placement and regular-file structure. */
    private declarationIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const basename = path.basename(analysis.filePath);
        const moduleName =
            this.paths.moduleName(analysis.filePath) ?? 'unknown';

        if (basename === 'interfaces.ts') {
            this.pushCountIssue(
                issues,
                analysis,
                analysis.constantCount,
                'DECLARATION_CONSTANT_LOCATION',
                'Constants must be declared in constants.ts.',
            );
            this.pushCountIssue(
                issues,
                analysis,
                analysis.typeCount,
                'DECLARATION_TYPE_LOCATION',
                'Type aliases must be declared in types.ts.',
            );
            return issues;
        }

        if (basename === 'constants.ts') {
            this.pushCountIssue(
                issues,
                analysis,
                analysis.interfaceCount,
                'DECLARATION_INTERFACE_LOCATION',
                'Interfaces must be declared in interfaces.ts.',
            );
            this.pushCountIssue(
                issues,
                analysis,
                analysis.typeCount,
                'DECLARATION_TYPE_LOCATION',
                'Type aliases must be declared in types.ts.',
            );
            return issues;
        }

        if (basename === 'types.ts') {
            this.pushCountIssue(
                issues,
                analysis,
                analysis.interfaceCount,
                'DECLARATION_INTERFACE_LOCATION',
                'Interfaces must be declared in interfaces.ts.',
            );
            this.pushCountIssue(
                issues,
                analysis,
                analysis.constantCount,
                'DECLARATION_CONSTANT_LOCATION',
                'Constants must be declared in constants.ts.',
            );
            return issues;
        }

        this.pushCountIssue(
            issues,
            analysis,
            analysis.interfaceCount,
            'DECLARATION_INTERFACE_LOCATION',
            `Interfaces must be declared in module/${moduleName}/interfaces.ts.`,
        );
        this.pushCountIssue(
            issues,
            analysis,
            analysis.typeCount,
            'DECLARATION_TYPE_LOCATION',
            `Type aliases must be declared in module/${moduleName}/types.ts.`,
        );
        this.pushCountIssue(
            issues,
            analysis,
            analysis.constantCount,
            'DECLARATION_CONSTANT_LOCATION',
            `Constants must be declared in module/${moduleName}/constants.ts.`,
        );
        this.pushCountIssue(
            issues,
            analysis,
            analysis.functionCount,
            'MODULE_FREE_FUNCTION',
            'Free function declarations are forbidden in regular module files.',
        );
        const auxiliary = this.paths.auxiliaryPath(analysis.filePath);
        if (auxiliary && analysis.classBaseNames.length !== 1) {
            issues.push(
                this.issue(
                    analysis,
                    'AUX_CLASS_COUNT',
                    'Auxiliary files must declare exactly one class.',
                ),
            );
        } else if (!auxiliary && analysis.classBaseNames.length > 1) {
            issues.push(
                this.issue(
                    analysis,
                    'MODULE_CLASS_COUNT',
                    'Regular module files may declare at most one class.',
                ),
            );
        }
        return issues;
    }

    /** Checks required base classes for conventional architecture folders. */
    private classIssues(analysis: SourceAnalysis): LintIssue[] {
        if (analysis.classBaseNames.length === 0) {
            return [];
        }

        const auxiliary = this.paths.auxiliaryPath(analysis.filePath);
        if (
            this.paths.modulePathDepth(analysis.filePath)! > 2 &&
            !auxiliary
        ) {
            return [];
        }
        const allowedBases: Record<string, readonly string[]> = {
            controller: ['BaseController'],
            service: ['BaseService'],
            store: ['BaseStore'],
            object: ['BaseObject'],
            dto: ['BaseDTO', 'EntityDTO'],
            api: [
                'BaseHandler',
                'HttpHandler',
                'WebSocketHandler',
                'CliHandler',
                'NodeHandler',
            ],
        };
        const layer = this.paths.layer(analysis.filePath);
        const auxiliaryBases: Record<string, readonly string[]> = {
            api: ['BaseApiAux'],
            controller: ['BaseControllerAux'],
            service: ['BaseServiceAux'],
            store: ['BaseStoreAux'],
        };
        const allowed = auxiliary
            ? auxiliaryBases[layer]
            : allowedBases[layer];
        if (!allowed) {
            return [];
        }

        const invalidBase = analysis.classBaseNames.find(
            (baseName) => !baseName || !allowed.includes(baseName),
        );
        if (invalidBase === undefined) {
            return [];
        }
        return [
            this.issue(
                analysis,
                'LAYER_BASE_CLASS',
                `Classes in ${layer}/ must extend ${allowed.join(' or ')}; found ${invalidBase ?? 'no base class'}.`,
            ),
        ];
    }

    /** Validates auxiliary depth, supported layers, and owner-file binding. */
    private auxiliaryPathIssues(analysis: SourceAnalysis): LintIssue[] {
        const depth = this.paths.modulePathDepth(analysis.filePath);
        if (depth === null || depth <= 2) {
            return [];
        }

        const layer = this.paths.layer(analysis.filePath);
        if (!this.paths.supportsAuxiliaryLayer(layer)) {
            return [
                this.issue(
                    analysis,
                    'AUX_LAYER_UNSUPPORTED',
                    `Layer '${layer}' may not contain auxiliary folders.`,
                ),
            ];
        }
        if (depth !== 3) {
            return [
                this.issue(
                    analysis,
                    'AUX_PATH_DEPTH',
                    'Auxiliary classes must be placed exactly one folder below their layer.',
                ),
            ];
        }

        const auxiliary = this.paths.auxiliaryPath(analysis.filePath);
        if (!auxiliary || this.auxiliaryOwnerExists(analysis.filePath)) {
            return [];
        }
        return [
            this.issue(
                analysis,
                'AUX_OWNER_MISSING',
                `Auxiliary folder '${auxiliary.owner}' requires a matching ${auxiliary.layer} owner file.`,
            ),
        ];
    }

    /** Returns whether an auxiliary folder has its required direct owner file. */
    private auxiliaryOwnerExists(filePath: string): boolean {
        const auxiliary = this.paths.auxiliaryPath(filePath);
        if (!auxiliary) {
            return false;
        }
        const layerDirectory = path.dirname(path.dirname(filePath));
        if (auxiliary.layer === 'api') {
            return fs.readdirSync(layerDirectory).some(
                (entry) =>
                    entry.startsWith(`${auxiliary.owner}.`) &&
                    entry.endsWith('.handler.ts') &&
                    fs.statSync(path.join(layerDirectory, entry)).isFile(),
            );
        }
        return fs.existsSync(
            path.join(
                layerDirectory,
                `${auxiliary.owner}.${auxiliary.layer}.ts`,
            ),
        );
    }

    /** Checks forbidden dependency directions between architecture layers. */
    private layerImportIssues(analysis: SourceAnalysis): LintIssue[] {
        const sourceLayer = this.paths.layer(analysis.filePath);
        const forbiddenLayers: Record<string, readonly string[]> = {
            controller: ['store', 'object', 'api'],
            service: ['controller', 'api'],
            store: ['dto', 'service', 'controller', 'api'],
            api: ['service', 'store'],
            dto: ['api', 'controller', 'service', 'store'],
        };
        const forbidden = forbiddenLayers[sourceLayer];
        if (!forbidden) {
            return [];
        }

        const issues: LintIssue[] = [];
        for (const dependency of analysis.dependencies) {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            if (!target) {
                continue;
            }
            const targetLayer = this.paths.layer(target);
            const targetBasename = path.basename(target);
            const importsForbiddenBase =
                (sourceLayer === 'api' &&
                    ['base.service.ts', 'base.store.ts'].includes(
                        targetBasename,
                    )) ||
                (sourceLayer === 'store' &&
                    ['base.dto.ts', 'base.database.ts'].includes(
                        targetBasename,
                    ));

            if (forbidden.includes(targetLayer) || importsForbiddenBase) {
                issues.push(
                    this.issue(
                        analysis,
                        'LAYER_IMPORT_DIRECTION',
                        `${sourceLayer}/ may not depend on ${dependency.source}.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Enforces private, one-way ownership of auxiliary implementations. */
    private auxiliaryImportIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const sourceAuxiliary = this.paths.auxiliaryPath(analysis.filePath);

        for (const dependency of analysis.dependencies) {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            if (!target) {
                continue;
            }
            const targetAuxiliary = this.paths.auxiliaryPath(target);
            if (targetAuxiliary) {
                if (dependency.kind === 'export') {
                    issues.push(
                        this.issue(
                            analysis,
                            'AUX_REEXPORT',
                            `Auxiliary implementation ${dependency.source} may not be re-exported.`,
                        ),
                    );
                } else if (
                    !this.paths.isAuxiliaryOwner(
                        analysis.filePath,
                        targetAuxiliary,
                    )
                ) {
                    issues.push(
                        this.issue(
                            analysis,
                            'AUX_IMPORT_OWNER',
                            `Only the matching ${targetAuxiliary.layer} owner may import ${dependency.source}.`,
                        ),
                    );
                }
                continue;
            }

            if (
                sourceAuxiliary &&
                this.paths.moduleName(target) ===
                    this.paths.moduleName(analysis.filePath) &&
                this.paths.layer(target) === sourceAuxiliary.layer
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'AUX_IMPORT_DIRECTION',
                        'Auxiliary classes may not import files from their own layer.',
                    ),
                );
            }
        }
        return issues;
    }

    /** Enforces public entry-point imports between modules and domain isolation. */
    private moduleBoundaryIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const currentModule = this.paths.moduleName(analysis.filePath);

        for (const dependency of analysis.dependencies) {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            if (!target) {
                continue;
            }

            if (this.paths.isCompositionFile(target)) {
                issues.push(
                    this.issue(
                        analysis,
                        'DOMAIN_COMPOSITION_IMPORT',
                        `Domain modules may not depend on composition file ${dependency.source}.`,
                    ),
                );
                continue;
            }

            const targetModule = this.paths.moduleName(target);
            if (
                targetModule &&
                targetModule !== currentModule &&
                !this.paths.isPublicModuleEntry(target)
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'CROSS_MODULE_PUBLIC_ENTRY',
                        `Module '${currentModule}' must import module '${targetModule}' through its index.ts.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Keeps object-to-DTO mapping out of controllers. */
    private controllerMappingIssues(analysis: SourceAnalysis): LintIssue[] {
        if (this.paths.layer(analysis.filePath) !== 'controller') {
            return [];
        }
        const forbiddenCalls = analysis.methodCalls.filter((methodName) =>
            ['fromObject', 'toObject'].includes(methodName),
        );
        return forbiddenCalls.map((methodName) =>
            this.issue(
                analysis,
                'CONTROLLER_MAPPING',
                `Controller mapping call '${methodName}' belongs in the service layer.`,
            ),
        );
    }

    /** Adds one issue only when a declaration count is non-zero. */
    private pushCountIssue(
        issues: LintIssue[],
        analysis: SourceAnalysis,
        count: number,
        ruleId: string,
        message: string,
    ): void {
        if (count > 0) {
            issues.push(this.issue(analysis, ruleId, message));
        }
    }

    /** Creates one normalized architecture issue. */
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
