import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from '@babel/parser';

type ScaffoldKind = 'component' | 'feature' | 'route';

interface PlannedFile {
    readonly path: string;
    readonly content: string;
}

export interface ScaffoldVerifier {
    verify(frontendRoot: string): void;
}

class NpmScaffoldVerifier implements ScaffoldVerifier {
    public verify(frontendRoot: string): void {
        for (const command of ['lint', 'typecheck']) {
            const result = spawnSync('npm', ['run', command], {
                cwd: frontendRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            if (result.status !== 0) {
                throw new Error(
                    result.stderr || result.stdout || `${command} failed.`,
                );
            }
        }
    }
}

/** Creates deterministic frontend architecture files with targeted rollback. */
export class FrontendScaffold {
    private readonly frontendRoot: string;
    private readonly sourceRoot: string;
    private readonly verifier: ScaffoldVerifier;

    public constructor(
        frontendRoot: string,
        verifier: ScaffoldVerifier = new NpmScaffoldVerifier(),
    ) {
        this.frontendRoot = path.resolve(frontendRoot);
        this.sourceRoot = path.join(this.frontendRoot, 'src');
        this.verifier = verifier;
    }

    /** Parses, validates, writes, and verifies one scaffold request. */
    public run(kind: string | undefined, arguments_: readonly string[]): number {
        if (arguments_.includes('--help')) {
            process.stdout.write(this.help());
            return 0;
        }
        if (!this.isKind(kind)) {
            process.stderr.write(this.help());
            return 1;
        }

        try {
            const plan = this.plan(kind, arguments_);
            this.assertTargetsAvailable(plan.files);
            const createdDirectories = this.missingDirectories(plan.files);
            try {
                this.apply(plan.files, plan.routerSource);
                this.verifier.verify(this.frontendRoot);
            } catch (error) {
                this.rollback(
                    plan.files,
                    plan.originalRouterSource,
                    createdDirectories,
                );
                throw error;
            }
            process.stdout.write(
                `Created ${kind} scaffold (${plan.files.length} files).\n`,
            );
            return 0;
        } catch (error) {
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 2;
        }
    }

    private plan(
        kind: ScaffoldKind,
        arguments_: readonly string[],
    ): {
        files: PlannedFile[];
        routerSource: string | null;
        originalRouterSource: string | null;
    } {
        if (kind === 'component') {
            return {
                files: this.componentFiles(arguments_),
                routerSource: null,
                originalRouterSource: null,
            };
        }
        if (kind === 'feature') {
            return {
                files: this.featureFiles(this.singleName(arguments_)),
                routerSource: null,
                originalRouterSource: null,
            };
        }
        return this.routePlan(this.singleName(arguments_));
    }

    private componentFiles(arguments_: readonly string[]): PlannedFile[] {
        if (arguments_.length !== 2) {
            throw new Error(
                'Usage: scaffold:component -- <desktop|tablet|mobile> <name>',
            );
        }
        const presentation = arguments_[0];
        if (!['desktop', 'tablet', 'mobile'].includes(presentation)) {
            throw new Error(`Unknown presentation '${presentation}'.`);
        }
        const name = this.validName(arguments_[1]);
        const symbol = this.pascal(name);
        return [{
            path: path.join(
                this.sourceRoot,
                'presentation',
                presentation,
                'components',
                `${symbol}.vue`,
            ),
            content: `<script setup lang="ts">\n/** Presentation-local ${symbol} component. */\n</script>\n\n<template>\n    <div class="${name}"></div>\n</template>\n\n<style scoped>\n.${name} {\n    display: block;\n}\n</style>\n`,
        }];
    }

    private featureFiles(name: string): PlannedFile[] {
        const symbol = this.pascal(name);
        return [
            {
                path: path.join(
                    this.sourceRoot,
                    'core/models',
                    `${name}.model.ts`,
                ),
                content: `/** Frontend model for ${symbol}. */\nexport interface ${symbol}Model {}\n`,
            },
            {
                path: path.join(
                    this.sourceRoot,
                    'core/services',
                    `${name}.service.ts`,
                ),
                content: `/** Application workflows for ${symbol}. */\nexport abstract class ${symbol}Service {}\n`,
            },
            {
                path: path.join(
                    this.sourceRoot,
                    'core/composables',
                    `${name}.composable.ts`,
                ),
                content: `/** Reactive application boundary for ${symbol}. */\nexport abstract class ${symbol}Composable {}\n`,
            },
        ];
    }

    private routePlan(name: string): {
        files: PlannedFile[];
        routerSource: string;
        originalRouterSource: string;
    } {
        const symbol = this.pascal(name);
        const files: PlannedFile[] = [];
        for (const presentation of ['desktop', 'tablet', 'mobile']) {
            files.push({
                path: path.join(
                    this.sourceRoot,
                    'presentation',
                    presentation,
                    'views',
                    `${symbol}View.vue`,
                ),
                content: `<template>\n    <section class="page">\n        <h1>${symbol}</h1>\n    </section>\n</template>\n\n<style scoped>\n</style>\n`,
            });
        }
        files.push({
            path: path.join(
                this.sourceRoot,
                'app/routes',
                `${symbol}Route.vue`,
            ),
            content: `<script setup lang="ts">\nimport DesktopView from '../../presentation/desktop/views/${symbol}View.vue';\nimport TabletView from '../../presentation/tablet/views/${symbol}View.vue';\nimport MobileView from '../../presentation/mobile/views/${symbol}View.vue';\nimport PresentationOutlet from '../PresentationOutlet.vue';\n</script>\n\n<template>\n    <PresentationOutlet\n        :desktop="DesktopView"\n        :tablet="TabletView"\n        :mobile="MobileView"\n    />\n</template>\n`,
        });
        const routerPath = path.join(this.sourceRoot, 'app/router.ts');
        const originalRouterSource = fs.readFileSync(routerPath, 'utf8');
        parse(originalRouterSource, {
            sourceType: 'module',
            plugins: ['typescript'],
        });
        const importAnchor = "import HomeRoute from './routes/HomeRoute.vue';";
        const routeAnchor = '    routes: [';
        if (
            !originalRouterSource.includes(importAnchor) ||
            !originalRouterSource.includes(routeAnchor)
        ) {
            throw new Error('Router structure is not scaffold-compatible.');
        }
        const routerSource = originalRouterSource
            .replace(
                importAnchor,
                `${importAnchor}\nimport ${symbol}Route from './routes/${symbol}Route.vue';`,
            )
            .replace(
                routeAnchor,
                `${routeAnchor}\n        {\n            path: '/${name}',\n            name: '${name}',\n            component: ${symbol}Route,\n        },`,
            );
        parse(routerSource, {
            sourceType: 'module',
            plugins: ['typescript'],
        });
        return {
            files,
            routerSource,
            originalRouterSource,
        };
    }

    private apply(files: readonly PlannedFile[], routerSource: string | null): void {
        for (const file of files) {
            fs.mkdirSync(path.dirname(file.path), { recursive: true });
            fs.writeFileSync(file.path, file.content, 'utf8');
        }
        if (routerSource !== null) {
            fs.writeFileSync(
                path.join(this.sourceRoot, 'app/router.ts'),
                routerSource,
                'utf8',
            );
        }
    }

    private rollback(
        files: readonly PlannedFile[],
        originalRouterSource: string | null,
        createdDirectories: readonly string[],
    ): void {
        for (const file of files) {
            fs.rmSync(file.path, { force: true });
        }
        if (originalRouterSource !== null) {
            fs.writeFileSync(
                path.join(this.sourceRoot, 'app/router.ts'),
                originalRouterSource,
                'utf8',
            );
        }
        for (const directory of [...createdDirectories].sort(
            (left, right) => right.length - left.length,
        )) {
            if (
                fs.existsSync(directory) &&
                fs.readdirSync(directory).length === 0
            ) {
                fs.rmdirSync(directory);
            }
        }
    }

    private missingDirectories(files: readonly PlannedFile[]): string[] {
        const directories = new Set<string>();
        for (const file of files) {
            let directory = path.dirname(file.path);
            while (
                directory.startsWith(this.sourceRoot) &&
                !fs.existsSync(directory)
            ) {
                directories.add(directory);
                directory = path.dirname(directory);
            }
        }
        return [...directories];
    }

    private assertTargetsAvailable(files: readonly PlannedFile[]): void {
        for (const file of files) {
            if (fs.existsSync(file.path)) {
                throw new Error(
                    `Target already exists: ${path.relative(this.frontendRoot, file.path)}`,
                );
            }
        }
    }

    private singleName(arguments_: readonly string[]): string {
        if (arguments_.length !== 1) {
            throw new Error('Exactly one kebab-case name is required.');
        }
        return this.validName(arguments_[0]);
    }

    private validName(name: string): string {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
            throw new Error(`Invalid kebab-case name '${name}'.`);
        }
        return name;
    }

    private pascal(name: string): string {
        return name
            .split('-')
            .map((part) => part[0].toUpperCase() + part.slice(1))
            .join('');
    }

    private isKind(value: string | undefined): value is ScaffoldKind {
        return ['component', 'feature', 'route'].includes(value ?? '');
    }

    private help(): string {
        return [
            'Usage:',
            '  scaffold:route -- <name>',
            '  scaffold:component -- <desktop|tablet|mobile> <name>',
            '  scaffold:feature -- <name>',
            'Exit codes: 0 success, 1 help/usage, 2 validation or verification error.',
            '',
        ].join('\n');
    }
}
