import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface PwaOptions {
    readonly appId: string;
    readonly name: string;
    readonly shortName: string;
}

interface PlannedPwaFile {
    readonly content: string;
    readonly relativePath: string;
}

export interface PwaScaffoldVerifier {
    verify(frontendRoot: string): void;
}

export interface PwaDependencyInstaller {
    install(frontendRoot: string): void;
    restore(frontendRoot: string): void;
}

class NpmPwaDependencyInstaller implements PwaDependencyInstaller {
    public install(frontendRoot: string): void {
        this.run(frontendRoot, [
            'install',
            '--save-dev',
            '--save-exact',
            '--workspace',
            '@app/web',
            'vite-plugin-pwa@1.3.0',
            'workbox-core@7.4.1',
            'workbox-precaching@7.4.1',
            'workbox-routing@7.4.1',
            'workbox-strategies@7.4.1',
        ]);
    }

    public restore(frontendRoot: string): void {
        this.run(frontendRoot, ['install']);
    }

    private run(frontendRoot: string, arguments_: readonly string[]): void {
        const projectRoot = path.resolve(frontendRoot, '../../..');
        const result = spawnSync('npm', [...arguments_], {
            cwd: projectRoot,
            encoding: 'utf8',
        });
        if (result.status !== 0) {
            throw new Error(
                result.stderr || result.stdout ||
                'PWA dependency installation failed.',
            );
        }
    }
}

class NpmPwaScaffoldVerifier implements PwaScaffoldVerifier {
    public verify(frontendRoot: string): void {
        const commands: readonly [string, readonly string[]][] = [
            ['npm', ['run', 'lint']],
            ['npm', ['run', 'typecheck']],
            ['npm', ['test', '--', '--run', 'test/pwa']],
        ];
        for (const [command, arguments_] of commands) {
            const result = spawnSync(command, [...arguments_], {
                cwd: frontendRoot,
                encoding: 'utf8',
            });
            if (result.status !== 0) {
                throw new Error(
                    result.stderr || result.stdout || 'PWA verification failed.',
                );
            }
        }
    }
}

/** Installs the optional shell-only PWA contract with targeted rollback. */
export class PwaScaffolder {
    private readonly frontendRoot: string;
    private readonly templateRoot: string;
    private readonly verifier: PwaScaffoldVerifier;
    private readonly dependencies: PwaDependencyInstaller;

    public constructor(
        frontendRoot: string,
        verifier: PwaScaffoldVerifier = new NpmPwaScaffoldVerifier(),
        dependencies: PwaDependencyInstaller =
            new NpmPwaDependencyInstaller(),
    ) {
        this.frontendRoot = path.resolve(frontendRoot);
        this.templateRoot = path.join(
            this.frontendRoot,
            'script/pwa-scaffold/templates',
        );
        this.verifier = verifier;
        this.dependencies = dependencies;
    }

    /** Validates, installs, verifies, and rolls back one PWA scaffold. */
    public run(arguments_: readonly string[]): number {
        if (arguments_.includes('--help')) {
            process.stdout.write(this.help());
            return 0;
        }
        try {
            const options = this.options(arguments_);
            this.assertNotInstalled();
            const planned = this.files(options);
            const modified = this.modifiedSources(options);
            const createdDirectories = this.missingDirectories(planned);
            const lock = this.lockSnapshot();
            this.assertTargetsAvailable(planned);
            try {
                for (const file of planned) {
                    const target = path.join(
                        this.frontendRoot,
                        file.relativePath,
                    );
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, file.content, 'utf8');
                }
                for (const [relativePath, sources] of modified) {
                    fs.writeFileSync(
                        path.join(this.frontendRoot, relativePath),
                        sources.updated,
                        'utf8',
                    );
                }
                this.dependencies.install(this.frontendRoot);
                this.verifier.verify(this.frontendRoot);
            } catch (error) {
                this.rollback(planned, modified, createdDirectories);
                try {
                    this.dependencies.restore(this.frontendRoot);
                } catch {
                    // Source and lockfile state are authoritative after rollback.
                }
                for (const [relativePath, sources] of modified) {
                    fs.writeFileSync(
                        path.join(this.frontendRoot, relativePath),
                        sources.original,
                        'utf8',
                    );
                }
                this.restoreLock(lock);
                throw error;
            }
            process.stdout.write(
                `Installed PWA scaffold for '${options.appId}'.\n`,
            );
            return 0;
        } catch (error) {
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 2;
        }
    }

    private options(arguments_: readonly string[]): PwaOptions {
        if (
            arguments_.length !== 5 ||
            arguments_[1] !== '--name' ||
            arguments_[3] !== '--short-name'
        ) {
            throw new Error(this.help().trim());
        }
        const [appId, , name, , shortName] = arguments_ as [
            string,
            string,
            string,
            string,
            string,
        ];
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(appId)) {
            throw new Error('PWA app ID must be kebab-case.');
        }
        for (const [label, value, maximum] of [
            ['name', name, 80],
            ['short name', shortName, 24],
        ] as const) {
            if (value.trim() !== value || value.length < 1 ||
                value.length > maximum || /[\u0000-\u001f]/u.test(value)) {
                throw new Error(`Invalid PWA ${label}.`);
            }
        }
        return { appId, name, shortName };
    }

    private files(options: PwaOptions): PlannedPwaFile[] {
        const definitions = [
            ['pwa-cache-policy.ts.template', 'src/app/pwa-cache-policy.ts'],
            ['runtime-config-cache.ts.template', 'src/app/runtime-config-cache.ts'],
            ['pwa-lifecycle.ts.template', 'src/app/pwa-lifecycle.ts'],
            ['sw.ts.template', 'src/app/sw.ts'],
            ['pwa.d.ts.template', 'src/app/pwa.d.ts'],
            ['playwright.pwa.config.ts.template', 'playwright.pwa.config.ts'],
            ['pwa.spec.ts.template', 'test/pwa-e2e/pwa.spec.ts'],
            ['pwa-cache.test.ts.template', 'test/pwa/pwa-cache.test.ts'],
            ['icon.svg.template', `public/icons/${options.appId}-192.svg`],
            ['icon.svg.template', `public/icons/${options.appId}-512.svg`],
            ['icon-maskable.svg.template', `public/icons/${options.appId}-maskable.svg`],
        ] as const;
        return [
            ...definitions.map(([template, relativePath]) => ({
                relativePath,
                content: this.render(template, options),
            })),
            {
                relativePath: '.pwa-scaffold.json',
                content: `${JSON.stringify({
                    schemaVersion: 1,
                    appId: options.appId,
                }, null, 2)}\n`,
            },
        ];
    }

    private modifiedSources(
        options: PwaOptions,
    ): Map<string, { original: string; updated: string }> {
        const vite = this.source('vite.config.ts');
        const main = this.source('src/main.ts');
        const manifest = JSON.parse(this.source('package.json')) as {
            scripts?: Record<string, string>;
        };
        if (
            !vite.includes("import vue from '@vitejs/plugin-vue';") ||
            !vite.includes('    plugins: [vue()],') ||
            !main.includes("import './shared/styles/main.scss';") ||
            !main.includes("createApp(App).use(router).mount('#app');")
        ) {
            throw new Error('Frontend composition is not PWA-scaffold compatible.');
        }
        const pwaConfig = this.render('vite-plugin.ts.template', options);
        const updatedVite = vite
            .replace(
                "import vue from '@vitejs/plugin-vue';",
                "import { randomUUID } from 'node:crypto';\n" +
                "import vue from '@vitejs/plugin-vue';\n" +
                "import { VitePWA } from 'vite-plugin-pwa';",
            )
            .replace(
                'export default defineConfig({',
                'const pwaShellVersion = randomUUID();\n\n' +
                'export default defineConfig({',
            )
            .replace('    plugins: [vue()],', pwaConfig.trimEnd());
        const updatedMain = main
            .replace(
                "import './shared/styles/main.scss';",
                "import './shared/styles/main.scss';\nimport { pwaLifecycle } from './app/pwa-lifecycle.ts';",
            )
            .replace(
                "createApp(App).use(router).mount('#app');",
                "createApp(App).use(router).mount('#app');\npwaLifecycle.start(window, navigator);",
            );
        manifest.scripts = {
            ...(manifest.scripts ?? {}),
            'test:e2e:pwa':
                'playwright test --config playwright.pwa.config.ts',
        };
        return new Map([
            ['vite.config.ts', { original: vite, updated: updatedVite }],
            ['src/main.ts', { original: main, updated: updatedMain }],
            ['package.json', {
                original: this.source('package.json'),
                updated: `${JSON.stringify(manifest, null, 2)}\n`,
            }],
        ]);
    }

    private assertNotInstalled(): void {
        if (
            fs.existsSync(path.join(this.frontendRoot, '.pwa-scaffold.json')) ||
            this.source('vite.config.ts').includes('VitePWA')
        ) {
            throw new Error('PWA scaffold is already installed.');
        }
    }

    private assertTargetsAvailable(files: readonly PlannedPwaFile[]): void {
        const collision = files.find((file) => fs.existsSync(
            path.join(this.frontendRoot, file.relativePath),
        ));
        if (collision) {
            throw new Error(`PWA target already exists: ${collision.relativePath}`);
        }
    }

    private rollback(
        files: readonly PlannedPwaFile[],
        modified: ReadonlyMap<string, { original: string }>,
        createdDirectories: readonly string[],
    ): void {
        for (const file of files) {
            fs.rmSync(path.join(this.frontendRoot, file.relativePath), {
                force: true,
            });
        }
        for (const [relativePath, sources] of modified) {
            fs.writeFileSync(
                path.join(this.frontendRoot, relativePath),
                sources.original,
                'utf8',
            );
        }
        for (const directory of createdDirectories) {
            if (
                fs.existsSync(directory) &&
                fs.readdirSync(directory).length === 0
            ) {
                fs.rmdirSync(directory);
            }
        }
    }

    private missingDirectories(files: readonly PlannedPwaFile[]): string[] {
        const missing = new Set<string>();
        for (const file of files) {
            let directory = path.dirname(path.join(
                this.frontendRoot,
                file.relativePath,
            ));
            while (
                directory.startsWith(`${this.frontendRoot}${path.sep}`) &&
                !fs.existsSync(directory)
            ) {
                missing.add(directory);
                directory = path.dirname(directory);
            }
        }
        return [...missing].sort((left, right) => right.length - left.length);
    }

    private lockSnapshot(): { readonly path: string; readonly source?: Buffer } {
        const lockPath = path.resolve(
            this.frontendRoot,
            '../../../package-lock.json',
        );
        return {
            path: lockPath,
            source: fs.existsSync(lockPath)
                ? fs.readFileSync(lockPath)
                : undefined,
        };
    }

    private restoreLock(
        snapshot: { readonly path: string; readonly source?: Buffer },
    ): void {
        if (snapshot.source) {
            fs.writeFileSync(snapshot.path, snapshot.source);
        } else if (fs.existsSync(snapshot.path)) {
            fs.rmSync(snapshot.path);
        }
    }

    private render(template: string, options: PwaOptions): string {
        return fs.readFileSync(path.join(this.templateRoot, template), 'utf8')
            .split('{{APP_ID}}').join(options.appId)
            .split('{{NAME}}').join(options.name)
            .split('{{SHORT_NAME}}').join(options.shortName);
    }

    private source(relativePath: string): string {
        return fs.readFileSync(
            path.join(this.frontendRoot, relativePath),
            'utf8',
        );
    }

    private help(): string {
        return 'Usage: scaffold:pwa -- <app-id> --name "<Name>" ' +
            '--short-name "<Short Name>"\n';
    }
}
