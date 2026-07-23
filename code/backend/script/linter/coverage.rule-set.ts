import fs from 'node:fs';
import type { LintIssue, SourceAnalysis } from './interfaces.ts';
import { FileScanner } from './file.scanner.ts';
import { PathResolver } from './path.resolver.ts';

/** Relates concrete HTTP adapters to OpenAPI and backend tests. */
export class CoverageRuleSet {
    private readonly testSource: string;
    private readonly openApiSource: string;
    private readonly paths: PathResolver;
    private readonly openApiError: string | null;

    /** Loads checked-in contract and test sources once. */
    // fallow-ignore-next-line complexity -- Validates two independent project contracts during construction.
    constructor(paths: PathResolver) {
        this.paths = paths;
        const scanner = new FileScanner();
        this.testSource = scanner
            .listTypeScriptFiles(paths.testRoot())
            .map((filePath) => fs.readFileSync(filePath, 'utf8'))
            .join('\n');
        this.openApiSource = fs.existsSync(paths.openApiDocument())
            ? fs.readFileSync(paths.openApiDocument(), 'utf8')
            : '';
        this.openApiError =
            this.openApiSource &&
            /^openapi:\s+3\.\d+\.\d+/mu.test(this.openApiSource) &&
            /^paths:\s*(?:\{\})?\s*$/mu.test(this.openApiSource)
                ? null
                : 'openapi.yaml must contain a valid OpenAPI version and paths map.';
    }

    /** Reports a missing or structurally unreadable OpenAPI contract. */
    public configurationIssues(): LintIssue[] {
        return this.openApiError
            ? [
                  {
                      ruleId: 'OPENAPI_PARSE_ERROR',
                      severity: 'fatal',
                      file: this.paths.relative(
                          this.paths.openApiDocument(),
                      ),
                      message: this.openApiError,
                  },
              ]
            : [];
    }

    /** Checks one HTTP handler or concrete store for coverage. */
    // fallow-ignore-next-line complexity -- Coordinates independently tested HTTP and Store coverage rules.
    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        if (analysis.filePath.endsWith('.http.handler.ts')) {
            const routes = [
                ...analysis.source.matchAll(
                    /['"](\/api\/[A-Za-z0-9_./{}:-]+)['"]/gu,
                ),
            ].map((match) => match[1]);
            if (
                routes.length === 0 &&
                analysis.classes.some((classAnalysis) =>
                    classAnalysis.methodNames.includes('processRequest'),
                )
            ) {
                issues.push(
                    this.issue(
                        analysis,
                        'HTTP_OPENAPI_COVERAGE',
                        'Concrete HTTP handlers must declare a literal /api route.',
                    ),
                );
            }
            const method =
                analysis.source
                    .match(
                        /(?:request|req)\.method\s*!==?\s*['"]([A-Z]+)['"]/u,
                    )?.[1]
                    ?.toLowerCase() ?? null;
            for (const route of new Set(routes)) {
                const routeOffset = this.openApiSource.search(
                    new RegExp(
                        `^\\s{4}${this.escape(route)}:\\s*$`,
                        'mu',
                    ),
                );
                const routeTail =
                    routeOffset >= 0
                        ? this.openApiSource.slice(routeOffset + 1)
                        : '';
                const nextRouteOffset = routeTail.search(/^ {4}\//mu);
                const routeBlock =
                    routeOffset >= 0
                        ? this.openApiSource.slice(
                              routeOffset,
                              nextRouteOffset >= 0
                                  ? routeOffset + 1 + nextRouteOffset
                                  : undefined,
                          )
                        : '';
                if (
                    routeOffset < 0 ||
                    (method &&
                        !new RegExp(`^\\s{8}${method}:\\s*$`, 'mu').test(
                            routeBlock,
                        ))
                ) {
                    issues.push(
                        this.issue(
                            analysis,
                            'HTTP_OPENAPI_COVERAGE',
                            `HTTP operation '${method ?? 'unknown'} ${route}' is missing from openapi.yaml.`,
                        ),
                    );
                }
                if (!this.testSource.includes(route)) {
                    issues.push(
                        this.issue(
                            analysis,
                            'MODULE_TEST_COVERAGE',
                            `HTTP route '${route}' has no backend test coverage.`,
                        ),
                    );
                }
            }
        }
        if (
            this.paths.layer(analysis.filePath) === 'store' &&
            !this.paths.auxiliaryPath(analysis.filePath) &&
            /\.(selectFrom|insertInto|updateTable|deleteFrom)\s*\(/u.test(
                analysis.source,
            )
        ) {
            const className = analysis.classes[0]?.name;
            if (className && !this.testSource.includes(className)) {
                issues.push(
                    this.issue(
                        analysis,
                        'MODULE_TEST_COVERAGE',
                        `Store '${className}' has no backend test coverage.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Escapes one route for use in a regular expression. */
    private escape(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    }

    /** Creates one normalized issue. */
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
