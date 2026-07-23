import fs from 'node:fs';
import path from 'node:path';
import type { LintIssue, SourceAnalysis } from './interfaces.ts';
import { FileScanner } from './file.scanner.ts';
import { PathResolver } from './path.resolver.ts';

const ROOT_FILES = new Set([
    'index.ts',
    'interfaces.ts',
    'types.ts',
    'constants.ts',
]);
const LAYERS = new Set([
    'api',
    'controller',
    'service',
    'store',
    'object',
    'dto',
]);

/** Enforces whole-project module shape, registration, and file naming. */
export class ProjectRuleSet {
    private readonly scanner = new FileScanner();
    private readonly paths: PathResolver;

    /** Creates project rules for one repository path model. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Checks directory shape and mandatory module entry points. */
    // fallow-ignore-next-line complexity -- Walks independent, fixture-tested module structure rules.
    public evaluateStructure(): LintIssue[] {
        const issues: LintIssue[] = [];
        for (const moduleDirectory of this.scanner.listDirectDirectories(
            this.paths.moduleRoot(),
        )) {
            const moduleName = path.basename(moduleDirectory);
            const entryPath = path.join(moduleDirectory, 'index.ts');
            if (!fs.existsSync(entryPath)) {
                issues.push(
                    this.issue(
                        entryPath,
                        'MODULE_ENTRY_MISSING',
                        `Module '${moduleName}' requires a public index.ts.`,
                    ),
                );
            } else {
                issues.push(...this.entryIssues(entryPath, moduleName));
            }

            for (const filePath of this.scanner.listDirectFiles(
                moduleDirectory,
            )) {
                const basename = path.basename(filePath);
                if (!ROOT_FILES.has(basename)) {
                    issues.push(
                        this.issue(
                            filePath,
                            filePath.endsWith('.ts')
                                ? 'MODULE_ROOT_PLACEMENT'
                                : 'MODULE_NON_SOURCE_FILE',
                            filePath.endsWith('.ts')
                                ? 'Classes and implementation files belong in an architecture layer.'
                                : 'Module directories may contain TypeScript source files only.',
                        ),
                    );
                }
            }

            for (const directory of this.scanner.listDirectDirectories(
                moduleDirectory,
            )) {
                const layer = path.basename(directory);
                if (!LAYERS.has(layer)) {
                    issues.push(
                        this.issue(
                            directory,
                            'MODULE_DIRECTORY_UNKNOWN',
                            `Unknown module directory '${layer}'.`,
                        ),
                    );
                } else if (this.scanner.isEmptyDirectory(directory)) {
                    issues.push(
                        this.issue(
                            directory,
                            'MODULE_DIRECTORY_EMPTY',
                            `Empty layer directory '${layer}' must be removed.`,
                        ),
                    );
                }
            }

            const catalog = this.readOptional(this.paths.moduleCatalog());
            if (
                fs.existsSync(entryPath) &&
                (!catalog.includes(`./module/${moduleName}/index.ts`) ||
                    !catalog.includes(
                        `${this.pascal(moduleName)}Module.definition`,
                    ))
            ) {
                issues.push(
                    this.issue(
                        entryPath,
                        'MODULE_REGISTRATION_MISSING',
                        `Module '${moduleName}' is missing from module.catalog.ts.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Checks filename, class name, and local import extension conventions. */
    // fallow-ignore-next-line complexity -- Applies independent naming and import conventions.
    public evaluateSource(analysis: SourceAnalysis): LintIssue[] {
        const issues: LintIssue[] = [];
        const layer = this.paths.layer(analysis.filePath);
        if (LAYERS.has(layer)) {
            if (
                this.paths.modulePathDepth(analysis.filePath) === 2 &&
                analysis.classes.length !== 1
            ) {
                issues.push(
                    this.issue(
                        analysis.filePath,
                        'LAYER_CLASS_COUNT',
                        'Regular architecture files must declare exactly one class.',
                    ),
                );
            }
            const expected = this.expectedClass(analysis.filePath, layer);
            if (!expected) {
                issues.push(
                    this.issue(
                        analysis.filePath,
                        'LAYER_FILE_NAME',
                        `File does not follow the ${layer} layer naming convention.`,
                    ),
                );
            } else if (
                analysis.classes.length === 1 &&
                analysis.classes[0].name !== expected
            ) {
                issues.push(
                    this.issue(
                        analysis.filePath,
                        'LAYER_CLASS_NAME',
                        `Class must be named ${expected} to match its file.`,
                    ),
                );
            }
        }

        for (const dependency of analysis.dependencies) {
            if (
                dependency.source.startsWith('.') &&
                !dependency.source.endsWith('.ts')
            ) {
                issues.push(
                    this.issue(
                        analysis.filePath,
                        'LOCAL_IMPORT_EXTENSION',
                        `Local dependency '${dependency.source}' must include the .ts extension.`,
                    ),
                );
            }
        }
        return issues;
    }

    /** Validates the public module class and port markers. */
    private entryIssues(entryPath: string, moduleName: string): LintIssue[] {
        const source = this.readOptional(entryPath);
        const interfaces = this.readOptional(
            path.join(path.dirname(entryPath), 'interfaces.ts'),
        );
        const pascalName = this.pascal(moduleName);
        const missing = [
            !new RegExp(
                `class\\s+${pascalName}Module\\s+[\\s\\S]*extends\\s+BaseModule`,
            ).test(source),
            !source.includes(`implements ${pascalName}ModulePort`),
            !source.includes('static readonly definition'),
            !new RegExp(
                'satisfies\\s+(Named)?ModuleDefinition|:\\s*(Named)?ModuleDefinition',
                'u',
            ).test(source),
            !interfaces.includes(`interface ${pascalName}ModulePort`),
            !new RegExp(
                `export\\s+type\\s+\\{\\s*${pascalName}ModulePort\\s*\\}`,
                'u',
            ).test(source),
        ];
        return missing.some(Boolean)
            ? [
                  this.issue(
                      entryPath,
                      'MODULE_ENTRY_CONTRACT',
                      `index.ts must expose ${pascalName}Module, ${pascalName}ModulePort, and a static definition.`,
                  ),
              ]
            : [];
    }

    /** Returns the class name prescribed by one architecture filename. */
    // fallow-ignore-next-line complexity -- Encodes the finite scaffold filename matrix.
    private expectedClass(filePath: string, layer: string): string | null {
        const basename = path.basename(filePath, '.ts');
        const auxiliary = this.paths.auxiliaryPath(filePath);
        if (auxiliary) {
            const suffix = `${layer}-aux`;
            if (!basename.endsWith(`.${suffix}`)) {
                return null;
            }
            return `${this.pascal(basename.slice(0, -suffix.length - 1))}${this.pascal(layer)}Aux`;
        }
        if (layer === 'api') {
            const match = basename.match(
                /^(.+)\.(http|websocket|cli|node)\.handler$/,
            );
            return match
                ? `${this.pascal(match[1])}${this.transportName(match[2])}Handler`
                : null;
        }
        const suffix = layer === 'dto' ? 'dto' : layer;
        if (!basename.endsWith(`.${suffix}`)) {
            return null;
        }
        const name = this.pascal(basename.slice(0, -suffix.length - 1));
        return `${name}${layer === 'dto' ? 'DTO' : this.pascal(layer)}`;
    }

    /** Converts a kebab-case architecture name to PascalCase. */
    private pascal(value: string): string {
        return value
            .split(/[-.]/)
            .filter(Boolean)
            .map((part) => part[0].toUpperCase() + part.slice(1))
            .join('');
    }

    /** Preserves established transport acronyms in handler class names. */
    private transportName(value: string): string {
        const names: Record<string, string> = {
            http: 'Http',
            websocket: 'WebSocket',
            cli: 'Cli',
            node: 'Node',
        };
        return names[value] ?? this.pascal(value);
    }

    /** Reads an optional text artifact. */
    private readOptional(filePath: string): string {
        return fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf8')
            : '';
    }

    /** Creates one normalized issue. */
    private issue(
        filePath: string,
        ruleId: string,
        message: string,
    ): LintIssue {
        return {
            ruleId,
            severity: 'error',
            file: this.paths.relative(filePath),
            message,
        };
    }
}
