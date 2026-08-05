import fs from 'node:fs';
import path from 'node:path';
import type { LintIssueDraft, SourceAnalysis } from './interfaces.ts';
import { FileScanner } from './file.scanner.ts';
import { PathResolver } from './path.resolver.ts';
import { TestCatalogManager } from '../test-catalog/test-catalog.manager.ts';

const EXECUTABLE_LAYERS = new Set([
    'api',
    'controller',
    'service',
    'store',
]);
const TEST_FILE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.test\.ts$/u;

/** Enforces module-local test ownership, structure, imports, and coverage. */
export class ModuleTestRuleSet {
    private readonly paths: PathResolver;
    private readonly scanner = new FileScanner();

    /** Creates module-test rules for one project path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Checks local test directories and the generated central catalog. */
    public configurationIssues(): LintIssueDraft[] {
        return [
            ...this.structureIssues(),
            ...this.catalogIssues(),
        ];
    }

    /** Rejects production imports or re-exports of module tests. */
    public evaluateProduction(analysis: SourceAnalysis): LintIssueDraft[] {
        return analysis.dependencies.flatMap((dependency) => {
            const target = this.paths.resolveDependency(
                analysis.filePath,
                dependency.source,
            );
            return target && this.paths.isModuleTestPath(target)
                ? [
                      this.issue(
                          analysis.filePath,
                          'MODULE_TEST_PRODUCTION_IMPORT',
                          'Production code must not import or re-export module-local tests.',
                      ),
                  ]
                : [];
        });
    }

    /** Enforces cross-module and re-export boundaries inside one test. */
    public evaluateTest(analysis: SourceAnalysis): LintIssueDraft[] {
        const sourceModule = this.paths.moduleName(analysis.filePath);
        return analysis.dependencies.flatMap((dependency) => [
            ...this.testReExportIssues(analysis, dependency.kind),
            ...this.testCrossImportIssues(
                analysis,
                dependency.source,
                sourceModule,
            ),
        ]);
    }

    /** Requires every executable module to own an executable local test. */
    public coverageIssues(
        production: readonly SourceAnalysis[],
        tests: readonly SourceAnalysis[],
    ): LintIssueDraft[] {
        const executableModules = new Set(
            production
                .filter((analysis) => this.isExecutable(analysis))
                .map((analysis) => this.paths.moduleName(analysis.filePath))
                .filter((name): name is string => Boolean(name)),
        );
        return [...executableModules]
            .sort((left, right) => left.localeCompare(right))
            .flatMap((moduleName) =>
                this.hasExecutableTest(moduleName, tests)
                    ? []
                    : [
                          this.issue(
                              path.join(
                                  this.paths.moduleRoot(),
                                  moduleName,
                                  'index.ts',
                              ),
                              'MODULE_TEST_COVERAGE',
                              `Executable module '${moduleName}' requires at least one direct test/*.test.ts file containing an executable node:test test().`,
                          ),
                      ],
            );
    }

    /** Returns module-test directory shape findings. */
    private structureIssues(): LintIssueDraft[] {
        return this.scanner
            .listDirectDirectories(this.paths.moduleRoot())
            .flatMap((moduleDirectory) =>
                this.testDirectoryIssues(
                    path.join(moduleDirectory, 'test'),
                ),
            );
    }

    /** Validates one optional direct module test directory. */
    private testDirectoryIssues(testDirectory: string): LintIssueDraft[] {
        if (!this.scanner.directoryExists(testDirectory)) {
            return [];
        }
        const issues: LintIssueDraft[] = [];
        issues.push(...this.emptyDirectoryIssues(testDirectory));
        for (const directory of this.scanner.listDirectDirectories(testDirectory)) {
            issues.push(
                this.issue(
                    directory,
                    'MODULE_TEST_STRUCTURE',
                    'Module-local test directories must not contain nested directories.',
                ),
            );
        }
        for (const filePath of this.scanner.listDirectFiles(testDirectory)) {
            if (!TEST_FILE_PATTERN.test(path.basename(filePath))) {
                issues.push(
                    this.issue(
                        filePath,
                        'MODULE_TEST_STRUCTURE',
                        'Module-local test files must use lowercase *.test.ts names.',
                    ),
                );
            }
        }
        return issues;
    }

    /** Rejects one dependency re-export from a module-local test. */
    private testReExportIssues(
        analysis: SourceAnalysis,
        dependencyKind: string,
    ): LintIssueDraft[] {
        return dependencyKind === 'export'
            ? [
                  this.issue(
                      analysis.filePath,
                      'MODULE_TEST_REEXPORT',
                      'Module-local tests must not re-export dependencies.',
                  ),
              ]
            : [];
    }

    /** Rejects one direct import from another module's internals. */
    private testCrossImportIssues(
        analysis: SourceAnalysis,
        dependencySource: string,
        sourceModule: string | null,
    ): LintIssueDraft[] {
        const target = this.paths.resolveDependency(
            analysis.filePath,
            dependencySource,
        );
        const targetModule = target ? this.paths.moduleName(target) : null;
        return target &&
            targetModule &&
            targetModule !== sourceModule &&
            !this.paths.isPublicModuleEntry(target)
            ? [
                  this.issue(
                      analysis.filePath,
                      'MODULE_TEST_CROSS_IMPORT',
                      `Tests must import module '${targetModule}' through its public index.ts.`,
                  ),
              ]
            : [];
    }

    /** Reports an explicitly created but empty module-test directory. */
    private emptyDirectoryIssues(testDirectory: string): LintIssueDraft[] {
        return this.scanner.isEmptyDirectory(testDirectory)
            ? [
                  this.issue(
                      testDirectory,
                      'MODULE_TEST_DIRECTORY_EMPTY',
                      'Module-local test directories must contain an executable *.test.ts file.',
                  ),
              ]
            : [];
    }

    /** Reports a missing or stale checked-in test catalog. */
    private catalogIssues(): LintIssueDraft[] {
        try {
            new TestCatalogManager(this.paths.backendRoot()).check();
            return [];
        } catch {
            return [
                this.issue(
                    this.paths.testCatalog(),
                    'TEST_CATALOG_DRIFT',
                    'Backend test discovery differs from test.catalog.ts. Run `npm run generate:test-catalog`.',
                ),
            ];
        }
    }

    /** Returns whether a production file contains a concrete executable class. */
    private isExecutable(analysis: SourceAnalysis): boolean {
        return (
            EXECUTABLE_LAYERS.has(this.paths.layer(analysis.filePath)) &&
            analysis.classes.some((candidate) => !candidate.isAbstract)
        );
    }

    /** Returns whether a module owns a direct executable test. */
    private hasExecutableTest(
        moduleName: string,
        tests: readonly SourceAnalysis[],
    ): boolean {
        return tests.some(
            (analysis) =>
                this.paths.moduleName(analysis.filePath) === moduleName &&
                this.paths.isModuleTestFile(analysis.filePath) &&
                analysis.testCallCount > 0,
        );
    }

    /** Creates one normalized module-test diagnostic draft. */
    private issue(
        filePath: string,
        ruleId: string,
        message: string,
    ): LintIssueDraft {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(filePath),
            message,
        };
    }
}
