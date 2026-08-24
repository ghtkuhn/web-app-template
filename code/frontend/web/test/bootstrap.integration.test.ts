import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
);
const frontendRoot = path.join(projectRoot, 'code/frontend/web');

function sourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    });
}

test('the frontend dependency contract uses Bootstrap without Pico', () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(frontendRoot, 'package.json'),
        'utf8',
    )) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
    };
    const lockfile = fs.readFileSync(
        path.join(projectRoot, 'package-lock.json'),
        'utf8',
    );

    expect(manifest.dependencies.bootstrap).toBe('^5.3.8');
    expect(manifest.dependencies['@popperjs/core']).toBe('^2.11.8');
    expect(manifest.devDependencies.sass).toBe('^1.103.1');
    expect(manifest.devDependencies['postcss-scss']).toBe('^4.0.9');
    expect(manifest.dependencies['@picocss/pico']).toBeUndefined();
    expect(lockfile).not.toContain('@picocss/pico');
    for (const filePath of sourceFiles(path.join(frontendRoot, 'src'))) {
        const source = fs.readFileSync(filePath, 'utf8').toLowerCase();
        expect(source).not.toContain('@picocss/pico');
        expect(source).not.toContain('--pico-');
    }
});

test('the global Bootstrap entrypoints retain Sass, JavaScript, and Tabler', () => {
    const mainScript = fs.readFileSync(
        path.join(frontendRoot, 'src/main.ts'),
        'utf8',
    );
    const mainStyle = fs.readFileSync(
        path.join(frontendRoot, 'src/shared/styles/main.scss'),
        'utf8',
    );

    expect(mainScript.match(/import 'bootstrap';/gu)).toHaveLength(1);
    expect(mainScript).toContain("import './shared/styles/main.scss';");
    expect(mainStyle).toContain('@use "bootstrap/scss/bootstrap" with (');
    expect(mainStyle).toContain('@import "./tabler/tabler-icons.css";');
    expect(mainStyle).not.toContain('--pico-');
    expect(fs.existsSync(
        path.join(frontendRoot, 'src/shared/styles/main.css'),
    )).toBe(false);

    const themeStart = mainScript.indexOf('colorMode.start();');
    const vueMount = mainScript.indexOf(
        "createApp(App).use(router).mount('#app');",
    );
    expect(themeStart).toBeGreaterThan(-1);
    expect(vueMount).toBeGreaterThan(themeStart);
});
