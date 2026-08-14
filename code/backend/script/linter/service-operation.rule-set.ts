import fs from 'node:fs';
import path from 'node:path';
import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { ServiceRouterManager } from '../module-tools/service-router.manager.ts';
import { SourceAnalyzer } from './source.analyzer.ts';

/** Enforces generated Service routers and one-operation-per-class contracts. */
export class ServiceOperationRuleSet {
    private readonly paths: PathResolver;
    private readonly routers: ServiceRouterManager;
    private readonly analyzer = new SourceAnalyzer();

    /** Creates rules for one repository model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
        this.routers = new ServiceRouterManager(
            path.resolve(paths.backendRoot(), '../..'),
        );
    }

    /** Evaluates one production module source. */
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        if (this.operationPath(analysis.filePath)) {
            return this.operationIssues(analysis);
        }
        if (this.directServicePath(analysis.filePath)) {
            return this.routerIssues(analysis);
        }
        return [];
    }

    /** Rejects obsolete Service Aux files after their migration. */
    public legacyIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        return path.basename(analysis.filePath).endsWith('.service-aux.ts')
            ? [this.issue(
                  analysis,
                  'SERVICE_AUX_FORBIDDEN',
                  'Service Aux classes are obsolete. Fix: Create an owner-bound *.operation.ts class extending BaseServiceOperation and route it through module:sync.',
              )]
            : [];
    }

    /** Checks Operation naming, inheritance, API shape, and isolation. */
    private operationIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const basename = path.basename(analysis.filePath, '.ts');
        const operationName = basename.endsWith('.operation')
            ? basename.slice(0, -'.operation'.length)
            : '';
        const expectedClass = operationName
            .split('-')
            .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
            .join('') + 'Operation';
        const class_ = analysis.classes[0];
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(operationName)) {
            issues.push(this.issue(
                analysis,
                'OPERATION_FILE_NAME',
                'Service Operation files must use <kebab-case>.operation.ts.',
            ));
        }
        if (class_?.name !== expectedClass) {
            issues.push(this.issue(
                analysis,
                'OPERATION_CLASS_NAME',
                `Operation class must be named ${expectedClass}.`,
            ));
        }
        const owner = this.paths.auxiliaryPath(analysis.filePath)?.owner ?? '';
        const expectedDependencies = `${this.pascal(owner)}ServiceDependencies`;
        if (
            class_?.baseName !== 'BaseServiceOperation' ||
            class_.baseTypeNames.length !== 3 ||
            class_.baseTypeNames[2] !== expectedDependencies
        ) {
            issues.push(this.issue(
                analysis,
                'OPERATION_BASE_CLASS',
                'Operation classes must extend BaseServiceOperation<Input, Output, OwnerServiceDependencies>.',
            ));
        }
        for (const dependency of analysis.dependencies) {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            if (target?.endsWith('.operation.ts')) {
                issues.push(this.issue(
                    analysis,
                    'OPERATION_PEER_IMPORT',
                    `Operation classes may not import peer Operation '${dependency.source}'.`,
                ));
            }
        }
        if (class_?.isAbstract) {
            return issues;
        }
        const publicMethods = analysis.classMethods.filter(
            (method) =>
                method.name !== 'constructor' &&
                method.accessibility !== 'private' &&
                method.accessibility !== 'protected',
        );
        const execute = publicMethods.find((method) => method.name === 'execute');
        if (
            !execute ||
            publicMethods.length !== 1 ||
            execute.parameterTypeNames.length !== 1 ||
            !execute.returnTypeName
        ) {
            issues.push(this.issue(
                analysis,
                'OPERATION_EXECUTE_CONTRACT',
                'A concrete Operation must expose exactly execute(input) with explicit input and return types.',
            ));
        }
        if (publicMethods.some((method) => method.name !== 'execute')) {
            issues.push(this.issue(
                analysis,
                'OPERATION_PUBLIC_METHOD',
                'Only execute may be public; make helpers private.',
            ));
        }
        const inputType = execute?.parameterTypeNames[0] ?? null;
        if (
            inputType &&
            inputType !== 'TSVoidKeyword' &&
            (inputType.startsWith('TS') ||
                !/^[A-Z][A-Za-z0-9]*$/.test(inputType) ||
                ['String', 'Number', 'Boolean', 'Object'].includes(inputType))
        ) {
            issues.push(this.issue(
                analysis,
                'OPERATION_INPUT_CONTRACT',
                'Operation input must be one named module contract or void.',
            ));
        }
        const servicePath = path.join(
            path.dirname(path.dirname(analysis.filePath)),
            `${owner}.service.ts`,
        );
        let routed = false;
        if (fs.existsSync(servicePath)) {
            try {
                routed = this.analyzer
                    .analyze(servicePath)
                    .constructorCalls.some(
                        (call) => call.className === expectedClass,
                    );
            } catch {
                routed = false;
            }
        }
        if (!routed) {
            issues.push(this.issue(
                analysis,
                'OPERATION_ROUTING_MISSING',
                `Concrete Operation ${expectedClass} is not constructed by its generated Service router.`,
            ));
        }
        return issues;
    }

    /** Checks one operation-owned direct Service against generated mechanics. */
    private routerIssues(analysis: SourceAnalysis): LintIssueDraft[] {
        const moduleName = this.paths.moduleName(analysis.filePath);
        if (!moduleName) {
            return [];
        }
        const expected = this.routers.expectedSources(moduleName).get(
            analysis.filePath,
        );
        if (!expected) {
            return [];
        }
        const issues: LintIssueDraft[] = [];
        if (analysis.classes[0]?.baseName !== 'BaseService') {
            issues.push(this.issue(
                analysis,
                'SERVICE_ROUTER_REQUIRED',
                'An operation-owned main Service must extend BaseService.',
            ));
        }
        const expectedMethods = this.routers.operationMethodNames(
            moduleName,
            analysis.filePath,
        );
        const publicMethods = analysis.classMethods.filter(
            (method) =>
                method.name !== 'constructor' &&
                method.accessibility !== 'private' &&
                method.accessibility !== 'protected',
        );
        const delegatesOnly = publicMethods.every(
            (method) =>
                method.name !== null &&
                expectedMethods.includes(method.name) &&
                method.statementCount === 1 &&
                method.calledMethods.length === 1 &&
                method.calledMethods[0] === 'execute',
        );
        if (!delegatesOnly || analysis.controlFlowCount > 0) {
            issues.push(this.issue(
                analysis,
                'SERVICE_ROUTER_BUSINESS_LOGIC',
                'Main Services may only construct Operations and delegate directly to execute.',
            ));
        }
        const expectedClasses = this.routers.operationClassNames(
            moduleName,
            analysis.filePath,
        );
        const constructedClasses = new Set(
            analysis.constructorCalls.map((call) => call.className),
        );
        if (
            expectedClasses.some(
                (className) => !constructedClasses.has(className),
            ) ||
            expectedMethods.some(
                (methodName) =>
                    !publicMethods.some((method) => method.name === methodName),
            )
        ) {
            issues.push(this.issue(
                analysis,
                'SERVICE_OPERATION_MISSING',
                'Every public Service method must be generated from one concrete Operation.',
            ));
        }
        if (analysis.source !== expected) {
            issues.push(this.issue(
                analysis,
                'SERVICE_ROUTER_DRIFT',
                `Generated Service router '${path.basename(analysis.filePath)}' is stale. Fix: Run npm run module:sync -- ${moduleName}.`,
            ));
        }
        return issues;
    }

    /** Returns whether a source path is an owner-bound Operation. */
    private operationPath(filePath: string): boolean {
        return (
            this.paths.layer(filePath) === 'service' &&
            this.paths.modulePathDepth(filePath) === 3 &&
            filePath.endsWith('.operation.ts')
        );
    }

    /** Returns whether a source path is a direct main Service. */
    private directServicePath(filePath: string): boolean {
        return (
            this.paths.layer(filePath) === 'service' &&
            this.paths.modulePathDepth(filePath) === 2 &&
            filePath.endsWith('.service.ts') &&
            fs.existsSync(filePath)
        );
    }

    /** Converts one validated kebab-case owner to PascalCase. */
    private pascal(value: string): string {
        return value
            .split('-')
            .filter(Boolean)
            .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
            .join('');
    }

    /** Creates one normalized rule finding. */
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
