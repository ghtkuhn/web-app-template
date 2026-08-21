import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import {
    PwaScaffolder,
    type PwaDependencyInstaller,
    type PwaScaffoldVerifier,
} from '../script/pwa-scaffold/pwa.scaffolder.ts';

const roots: string[] = [];
const frontendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

class PassingVerifier implements PwaScaffoldVerifier {
    public verify(): void {}
}

class FailingVerifier implements PwaScaffoldVerifier {
    public verify(): void {
        throw new Error('verification failed');
    }
}

class NoopDependencyInstaller implements PwaDependencyInstaller {
    public install(): void {}
    public restore(): void {}
}

class MutatingDependencyInstaller implements PwaDependencyInstaller {
    public restoreCalls = 0;

    public install(targetRoot: string): void {
        const manifestPath = path.join(targetRoot, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.devDependencies = { 'vite-plugin-pwa': '1.3.0' };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        fs.writeFileSync(
            path.resolve(targetRoot, '../../../package-lock.json'),
            'changed-lock',
        );
    }

    public restore(): void {
        this.restoreCalls += 1;
    }
}

function fixture(): string {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-scaffold-'));
    roots.push(project);
    const root = path.join(project, 'code/frontend/web');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'script/pwa-scaffold'), { recursive: true });
    fs.cpSync(
        path.join(frontendRoot, 'script/pwa-scaffold/templates'),
        path.join(root, 'script/pwa-scaffold/templates'),
        { recursive: true },
    );
    fs.writeFileSync(
        path.join(root, 'vite.config.ts'),
        "import { defineConfig } from 'vite';\n" +
        "import vue from '@vitejs/plugin-vue';\n" +
        'export default defineConfig({\n    plugins: [vue()],\n});\n',
    );
    fs.writeFileSync(
        path.join(root, 'src/main.ts'),
        "import './shared/styles/main.css';\n" +
        "createApp(App).use(router).mount('#app');\n",
    );
    fs.writeFileSync(
        path.join(root, 'package.json'),
        `${JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2)}\n`,
    );
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PWA scaffold validates identity and installs the complete opt-in surface', () => {
    const root = fixture();
    const scaffold = new PwaScaffolder(
        root,
        new PassingVerifier(),
        new NoopDependencyInstaller(),
    );

    expect(scaffold.run([
        'sample-app',
        '--name',
        'Sample Application',
        '--short-name',
        'Sample',
    ])).toBe(0);
    expect(fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8'))
        .toContain("strategies: 'injectManifest'");
    expect(fs.readFileSync(path.join(root, 'src/app/sw.ts'), 'utf8'))
        .toContain('new NetworkOnly()');
    expect(fs.existsSync(path.join(root, 'playwright.pwa.config.ts')))
        .toBe(true);
    expect(JSON.parse(fs.readFileSync(
        path.join(root, 'package.json'),
        'utf8',
    )).scripts['test:e2e:pwa']).toContain('playwright.pwa.config.ts');
    expect(scaffold.run([
        'sample-app',
        '--name',
        'Sample Application',
        '--short-name',
        'Sample',
    ])).toBe(2);
});

test('PWA scaffold rolls back every target and composition edit on failure', () => {
    const root = fixture();
    const project = path.resolve(root, '../../..');
    fs.writeFileSync(path.join(project, 'package-lock.json'), 'original-lock');
    const originalVite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const originalPackage = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const dependencies = new MutatingDependencyInstaller();

    expect(new PwaScaffolder(
        root,
        new FailingVerifier(),
        dependencies,
    ).run([
        'sample-app',
        '--name',
        'Sample Application',
        '--short-name',
        'Sample',
    ])).toBe(2);

    expect(fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8'))
        .toBe(originalVite);
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
        .toBe(originalPackage);
    expect(fs.existsSync(path.join(root, 'src/app/sw.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.pwa-scaffold.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src/app'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'public'))).toBe(false);
    expect(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'))
        .toBe('original-lock');
    expect(dependencies.restoreCalls).toBe(1);
});
