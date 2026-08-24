import path from 'node:path';

export type FrontendLayer = 'app' | 'core' | 'presentation' | 'shared' | 'root';
export type PresentationName = 'desktop' | 'tablet' | 'mobile';

/** Classifies frontend paths and resolves local source dependencies. */
export class PathResolver {
    private readonly projectRoot: string;
    private readonly frontendRootPath: string;
    private readonly sourceRootPath: string;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.frontendRootPath = path.join(
            this.projectRoot,
            'code/frontend/web',
        );
        this.sourceRootPath = path.join(this.frontendRootPath, 'src');
    }

    public frontendRoot(): string {
        return this.frontendRootPath;
    }

    public sourceRoot(): string {
        return this.sourceRootPath;
    }

    public relative(filePath: string): string {
        return path
            .relative(this.projectRoot, filePath)
            .split(path.sep)
            .join('/');
    }

    public segments(filePath: string): string[] {
        return path.relative(this.sourceRootPath, filePath).split(path.sep);
    }

    public layer(filePath: string): FrontendLayer {
        const first = this.segments(filePath)[0];
        return ['app', 'core', 'presentation', 'shared'].includes(first)
            ? (first as FrontendLayer)
            : 'root';
    }

    public presentation(filePath: string): PresentationName | null {
        const segments = this.segments(filePath);
        return segments[0] === 'presentation' &&
            ['desktop', 'tablet', 'mobile'].includes(segments[1])
            ? (segments[1] as PresentationName)
            : null;
    }

    public resolveDependency(
        sourceFile: string,
        dependency: string,
    ): string | null {
        return dependency.startsWith('.')
            ? path.resolve(path.dirname(sourceFile), dependency)
            : null;
    }

    public isWithinSource(filePath: string): boolean {
        const relative = path.relative(this.sourceRootPath, filePath);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    }
}
