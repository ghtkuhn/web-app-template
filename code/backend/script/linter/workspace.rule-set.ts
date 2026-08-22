import type { LintIssueDraft } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { ProjectModel } from './project.model.ts';

/** Protects root-owned workspace metadata and compiler configuration. */
export class WorkspaceRuleSet {
    private readonly paths: PathResolver;
    private readonly project: ProjectModel;

    /** Creates workspace rules for one repository. */
    constructor(paths: PathResolver, project: ProjectModel) {
        this.paths = paths;
        this.project = project;
    }

    /** Evaluates lockfile, toolchain, compiler, and verification ownership. */
    // fallow-ignore-next-line complexity -- Evaluates four independent workspace ownership contracts.
    public evaluate(): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        for (const lockfile of this.project.workspaceLockfiles()) {
            issues.push(
                this.issue(
                    lockfile,
                    'WORKSPACE_LOCKFILE_OWNERSHIP',
                    'Workspace package-lock.json files are forbidden; the repository root owns the only npm lockfile.',
                ),
            );
        }
        if (
            !fs.existsSync(this.paths.rootPackageManifest()) ||
            !fs.existsSync(this.paths.packageManifest()) ||
            !fs.existsSync(this.paths.compilerConfig())
        ) {
            return issues;
        }
        const root = this.project.rootPackage();
        const rootTools = this.record(root.devDependencies);
        const backend = this.project.backendPackage();
        const backendTools = this.record(backend.devDependencies);
        for (const tool of ['typescript']) {
            if (tool in backendTools) {
                issues.push(
                    this.issue(
                        this.paths.packageManifest(),
                        'TOOLCHAIN_DEPENDENCY_OWNERSHIP',
                        `${tool} is shared toolchain infrastructure and must be declared only in the root package.json.`,
                    ),
                );
            }
        }
        if (!('typescript' in rootTools)) {
            issues.push(
                this.issue(
                    this.paths.rootPackageManifest(),
                    'TOOLCHAIN_DEPENDENCY_OWNERSHIP',
                    'The repository root must own the shared TypeScript dependency.',
                ),
            );
        }
        const compiler = this.record(
            this.project.compilerConfig().compilerOptions,
        );
        const invalidCompiler =
            compiler.moduleResolution !== 'node' ||
            compiler.allowImportingTsExtensions !== true ||
            compiler.noEmit !== true;
        if (invalidCompiler) {
            issues.push(
                this.issue(
                    this.paths.compilerConfig(),
                    'ROOT_COMPILER_CONFIG_CONTRACT',
                    "tsconfig.base.json must set moduleResolution to 'node', allowImportingTsExtensions to true, and noEmit to true.",
                ),
            );
        }
        const scripts = this.record(backend.scripts);
        if ('verify' in scripts) {
            issues.push(
                this.issue(
                    this.paths.packageManifest(),
                    'WORKSPACE_VERIFY_OWNERSHIP',
                    'Workspace packages must not define a shortened verify script; use the repository-root npm run verify.',
                ),
            );
        }
        return issues;
    }

    /** Narrows an unknown JSON property to a record. */
    private record(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
    }

    /** Creates one normalized workspace finding. */
    private issue(file: string, ruleId: LintIssueDraft['ruleId'], observed: string): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(file),
            observed,
        };
    }
}
import fs from 'node:fs';
