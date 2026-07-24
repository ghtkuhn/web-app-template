import type {
    HttpTestOperation,
    LintIssue,
    SourceAnalysis,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { ProjectModel } from './project.model.ts';

/** Relates concrete HTTP and persistence adapters to executable tests. */
export class CoverageRuleSet {
    private readonly openApiSource: string;
    private readonly paths: PathResolver;
    private readonly tests: SourceAnalysis[];
    private readonly openApiError: string | null;

    /** Loads parsed tests and the checked-in API contract once. */
    constructor(paths: PathResolver, project?: ProjectModel) {
        this.paths = paths;
        const model = project ?? new ProjectModel(paths);
        this.tests = model.testAnalyses();
        this.openApiSource = model.openApiSource();
        this.openApiError =
            /^openapi:\s+3\.\d+\.\d+/mu.test(this.openApiSource) &&
            /^paths:\s*(?:\{\})?\s*$/mu.test(this.openApiSource)
                ? null
                : 'openapi.yaml must contain a valid OpenAPI version and paths map.';
    }

    /** Reports a structurally unreadable OpenAPI contract. */
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

    /** Checks one concrete HTTP handler or Store against executable evidence. */
    public evaluate(analysis: SourceAnalysis): LintIssue[] {
        if (analysis.filePath.endsWith('.http.handler.ts')) {
            return this.httpIssues(analysis);
        }
        if (
            this.paths.layer(analysis.filePath) === 'store' &&
            !this.paths.auxiliaryPath(analysis.filePath) &&
            analysis.classes[0]?.name &&
            analysis.methodCalls.some((method) =>
                ['selectFrom', 'insertInto', 'updateTable', 'deleteFrom'].includes(
                    method,
                ),
            )
        ) {
            return this.storeIssues(analysis);
        }
        return [];
    }

    /** Requires OpenAPI, executable request, and documented status evidence. */
    private httpIssues(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const operations = analysis.httpHandlerOperations;
        if (
            operations.length === 0 &&
            analysis.classes.some((candidate) =>
                candidate.methodNames.includes('processRequest'),
            )
        ) {
            return [
                this.issue(
                    analysis,
                    'HTTP_OPENAPI_COVERAGE',
                    'Concrete HTTP handlers must guard one literal /api route and method.',
                ),
            ];
        }
        for (const operation of operations) {
            const statuses = this.openApiStatuses(operation);
            if (statuses.length === 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'HTTP_OPENAPI_COVERAGE',
                        `HTTP operation '${operation.method.toLowerCase()} ${operation.path}' is missing from openapi.yaml.`,
                    ),
                );
            }
            const matchingTests = this.tests.filter((test) =>
                test.httpTestOperations.some(
                    (request) =>
                        request.path === operation.path &&
                        request.method === operation.method,
                ),
            );
            if (matchingTests.length === 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'HTTP_TEST_EXECUTABLE_COVERAGE',
                        `HTTP operation '${operation.method} ${operation.path}' requires an executable fetch() test; comments and string references do not count.`,
                    ),
                );
                continue;
            }
            const asserted = new Set(
                matchingTests.flatMap((test) => test.assertedHttpStatuses),
            );
            const missing = statuses.filter((status) => !asserted.has(status));
            if (missing.length > 0) {
                issues.push(
                    this.issue(
                        analysis,
                        'HTTP_STATUS_CONTRACT',
                        `Executable tests for '${operation.method} ${operation.path}' must assert documented statuses: ${missing.join(', ')}.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Requires Store construction and at least one persistence method call. */
    private storeIssues(analysis: SourceAnalysis): LintIssue[] {
        const className = analysis.classes[0]?.name;
        const tested = this.tests.some(
            (test) =>
                test.constructorCalls.some(
                    (call) => call.className === className,
                ) &&
                test.methodCalls.some((method) =>
                    /^(?:save|create|insert|update|delete|find)/u.test(method),
                ),
        );
        return tested
            ? []
            : [
                  this.issue(
                      analysis,
                      'STORE_TEST_EXECUTABLE_COVERAGE',
                      `Store '${className ?? 'unknown'}' must be constructed and execute a persistence method in a backend test.`,
                  ),
              ];
    }

    /** Returns documented statuses for one path and method. */
    private openApiStatuses(operation: HttpTestOperation): number[] {
        const escaped = operation.path.replace(
            /[.*+?^${}()|[\]\\]/gu,
            '\\$&',
        );
        const pathMatch = this.openApiSource.match(
            new RegExp(
                `^ {4}${escaped}:\\n([\\s\\S]*?)(?=^ {4}\\/|^components:|(?![\\s\\S]))`,
                'mu',
            ),
        );
        const methodMatch = pathMatch?.[1].match(
            new RegExp(
                `^ {8}${operation.method.toLowerCase()}:\\n([\\s\\S]*?)(?=^ {8}[a-z]+:|(?![\\s\\S]))`,
                'mu',
            ),
        );
        return [
            ...(methodMatch?.[1] ?? '').matchAll(
                /^ {16}["']?([1-5][0-9]{2})["']?:/gmu,
            ),
        ].map((match) => Number(match[1]));
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
