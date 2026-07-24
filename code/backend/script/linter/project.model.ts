import fs from 'node:fs';
import path from 'node:path';
import type { SourceAnalysis } from './interfaces.ts';
import { FileScanner } from './file.scanner.ts';
import { PathResolver } from './path.resolver.ts';
import { SourceAnalyzer } from './source.analyzer.ts';

/** Parsed project artifacts used by cross-file architecture rules. */
export class ProjectModel {
    private readonly analyzer = new SourceAnalyzer();
    private readonly scanner = new FileScanner();
    private readonly paths: PathResolver;

    /** Creates a lazy project reader for one normalized repository root. */
    constructor(paths: PathResolver) {
        this.paths = paths;
    }

    /** Returns structured analyses for every backend test file. */
    public testAnalyses(): SourceAnalysis[] {
        return this.scanner
            .listTypeScriptFiles(this.paths.testRoot())
            .map((filePath) => this.analyzer.analyze(filePath));
    }

    /** Parses the root package manifest. */
    public rootPackage(): Record<string, unknown> {
        return this.readJson(this.paths.rootPackageManifest());
    }

    /** Parses the backend workspace package manifest. */
    public backendPackage(): Record<string, unknown> {
        return this.readJson(this.paths.packageManifest());
    }

    /** Parses the shared compiler configuration. */
    public compilerConfig(): Record<string, unknown> {
        return this.readJson(this.paths.compilerConfig());
    }

    /** Returns workspace-local npm lockfiles below the repository root. */
    public workspaceLockfiles(): string[] {
        return [
            path.join(this.paths.backendRoot(), 'package-lock.json'),
            path.join(this.paths.frontendRoot(), 'package-lock.json'),
        ].filter((filePath) => fs.existsSync(filePath));
    }

    /** Returns the checked-in OpenAPI source for contract analysis. */
    // fallow-ignore-next-line unused-class-member -- Consumed by the coverage model across the linter boundary.
    public openApiSource(): string {
        return fs.readFileSync(this.paths.openApiDocument(), 'utf8');
    }

    /** Parses one required JSON artifact. */
    private readJson(filePath: string): Record<string, unknown> {
        const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(
                `${this.paths.relative(filePath)} must contain a JSON object.`,
            );
        }
        return value as Record<string, unknown>;
    }
}
