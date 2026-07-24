import fs from 'node:fs';
import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';

/** Ensures runtime packages are owned by the backend workspace. */
export class DependencyRuleSet {
    private readonly runtimeDependencies: Set<string>;
    private readonly paths: PathResolver;
    private readonly manifestError: string | null;

    /** Loads the backend workspace dependency contract once. */
    // fallow-ignore-next-line complexity -- Normalizes missing and malformed fixture manifests.
    constructor(paths: PathResolver) {
        this.paths = paths;
        let manifest: { dependencies?: Record<string, string> } = {};
        let manifestError: string | null = fs.existsSync(
            paths.packageManifest(),
        )
            ? null
            : 'Backend package.json is missing.';
        if (fs.existsSync(paths.packageManifest())) {
            try {
                manifest = JSON.parse(
                    fs.readFileSync(paths.packageManifest(), 'utf8'),
                ) as { dependencies?: Record<string, string> };
            } catch (error: unknown) {
                manifestError =
                    error instanceof Error
                        ? error.message
                        : 'Unknown package manifest error';
            }
        }
        this.manifestError = manifestError;
        this.runtimeDependencies = new Set(
            Object.keys(manifest.dependencies ?? {}),
        );
    }

    /** Reports malformed dependency metadata as a fatal linter error. */
    public configurationIssues(): LintIssueDraft[] {
        return this.manifestError
            ? [
                  {
                      ruleId: 'PACKAGE_MANIFEST_PARSE_ERROR',
                      severity: 'fatal',
                      file: this.paths.relative(
                          this.paths.packageManifest(),
                      ),
                      message: this.manifestError,
                  },
              ]
            : [];
    }

    /** Evaluates runtime package imports for one domain source file. */
    // fallow-ignore-next-line complexity -- Filters the finite npm import ownership cases.
    public evaluate(analysis: SourceAnalysis): LintIssueDraft[] {
        const issues: LintIssueDraft[] = [];
        const reported = new Set<string>();
        for (const dependency of analysis.dependencies) {
            if (
                dependency.typeOnly ||
                dependency.source.startsWith('.') ||
                dependency.source.startsWith('node:')
            ) {
                continue;
            }
            const packageName = this.packageName(dependency.source);
            if (
                !this.runtimeDependencies.has(packageName) &&
                !reported.has(packageName)
            ) {
                reported.add(packageName);
                issues.push({
                    ruleId: 'UNDECLARED_WORKSPACE_DEPENDENCY',
                    severity: 'error',
                    file: this.paths.relative(analysis.filePath),
                    message: `Runtime dependency '${packageName}' must be declared in code/backend/package.json.`,
                });
            }
        }
        return issues;
    }

    /** Returns the owning npm package for a package subpath import. */
    private packageName(source: string): string {
        const segments = source.split('/');
        return source.startsWith('@')
            ? segments.slice(0, 2).join('/')
            : segments[0];
    }
}
