import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { FrontendLinter } from '../../script/linter/frontend.linter.ts';
import type { LintWriter } from '../../script/linter/interfaces.ts';
import { LinterCli } from '../../script/linter/linter.cli.ts';

class Fixture {
    public readonly root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'frontend-linter-'),
    );

    public constructor() {
        this.write('main.ts', "import 'bootstrap';");
        this.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";`,
        );
    }

    public write(relativePath: string, source: string): void {
        const filePath = path.join(
            this.root,
            'code/frontend/web/src',
            relativePath,
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
    }

    public writeFrontend(relativePath: string, source: string): void {
        const filePath = path.join(
            this.root,
            'code/frontend/web',
            relativePath,
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
    }

    public remove(relativePath: string): void {
        fs.rmSync(path.join(
            this.root,
            'code/frontend/web/src',
            relativePath,
        ));
    }

    public issues() {
        return new FrontendLinter(this.root).run().issues;
    }

    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}

class BufferWriter implements LintWriter {
    public value = '';

    public write(chunk: string): void {
        this.value += chunk;
    }
}

test('real frontend satisfies all architecture rules', () => {
    const projectRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../..',
    );
    const result = new FrontendLinter(projectRoot).run();
    expect(result.issues).toEqual([]);
    expect(result.filesChecked).toBeGreaterThan(0);
});

test('presentation imports, network access, styles, and SFC syntax are strict', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'presentation/desktop/views/BadView.vue',
            `<script>
             import Other from '../../mobile/views/BadView.vue';
             fetch('/api');
             </script>
             <template><Other /></template>
             <style>@media (min-width: 1px) { div {} }</style>`,
        );
        const issues = fixture.issues();
        const ids = issues.map((issue) => issue.ruleId);
        expect(ids).toContain('PRESENTATION_CROSS_IMPORT');
        expect(ids).toContain('PRESENTATION_NETWORK_ACCESS');
        expect(ids).toContain('PRESENTATION_STYLE_SCOPE');
        expect(ids).toContain('PRESENTATION_MEDIA_QUERY');
        expect(ids).toContain('VUE_SCRIPT_SETUP');
        expect(ids).toContain('PRESENTATION_VIEW_PARITY');
        const crossImport = issues.find(
            (issue) => issue.ruleId === 'PRESENTATION_CROSS_IMPORT',
        );
        expect(crossImport?.location?.start.line).toBe(2);
        expect(crossImport?.relatedLocations).toHaveLength(1);
        expect(
            issues.find(
                (issue) => issue.ruleId === 'PRESENTATION_NETWORK_ACCESS',
            )?.location?.start.line,
        ).toBe(3);
        expect(
            issues.find(
                (issue) => issue.ruleId === 'PRESENTATION_MEDIA_QUERY',
            )?.location?.start.line,
        ).toBe(6);
    } finally {
        fixture.dispose();
    }
});

test('layer, router, breakpoint, shared, and naming ownership are enforced', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'core/service.ts',
            `import App from '../app/App.vue';
             createRouter({});
             console.log(window.innerWidth);`,
        );
        fixture.write(
            'shared/SharedWidget.vue',
            '<template><div /></template>',
        );
        fixture.write(
            'app/bad-name.vue',
            '<template><div /></template>',
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('FRONTEND_LAYER_DIRECTION');
        expect(ids).toContain('ROUTER_OWNERSHIP');
        expect(ids).toContain('PRESENTATION_BREAKPOINT_OWNERSHIP');
        expect(ids).toContain('SHARED_VUE_COMPONENT');
        expect(ids).toContain('VUE_COMPONENT_NAME');
    } finally {
        fixture.dispose();
    }
});

test('source structure and route presentation coverage are enforced', () => {
    const fixture = new Fixture();
    try {
        fixture.write('loose.ts', 'export const loose = true;');
        fixture.write(
            'presentation/desktop/direct.vue',
            '<template><div /></template>',
        );
        fixture.write(
            'app/routes/HomeRoute.vue',
            `<script setup lang="ts">
             import Desktop from '../../presentation/desktop/views/HomeView.vue';
             </script>
             <template><Desktop /></template>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('FRONTEND_SOURCE_PLACEMENT');
        expect(ids).toContain('PRESENTATION_STRUCTURE');
        expect(ids).toContain('ROUTE_PRESENTATION_COVERAGE');
    } finally {
        fixture.dispose();
    }
});

test('Core ownership, direction, environment, and design tokens are strict', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'core/loose.ts',
            'console.log(import.meta.env.VITE_API_BASE_URL);',
        );
        fixture.write(
            'core/models/account.model.ts',
            "import { HealthService } from '../services/health.service.ts'; sessionStorage.getItem('token');",
        );
        fixture.write(
            'presentation/desktop/components/Card.vue',
            `<script setup lang="ts">
             import type { paths } from '../../../core/api/generated/schema.ts';
             </script>
             <template><div /></template>
             <style scoped>div { color: #fff; }</style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('CORE_STRUCTURE');
        expect(ids).toContain('FRONTEND_ENV_OWNERSHIP');
        expect(ids).toContain('CORE_LAYER_DIRECTION');
        expect(ids).toContain('AUTH_TOKEN_STORAGE_OWNERSHIP');
        expect(ids).toContain('PRESENTATION_NETWORK_ACCESS');
        expect(ids).toContain('DESIGN_TOKEN_USAGE');
    } finally {
        fixture.dispose();
    }
});

test('Bootstrap Sass and JavaScript have global owners and may not use a CDN', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";`,
        );
        fixture.write('main.ts', "import 'bootstrap';");
        fixture.write(
            'presentation/desktop/views/BadView.vue',
            `<script setup lang="ts">import 'bootstrap/js/dist/modal';</script>
             <template><link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css"></template>
             <style scoped>@use "bootstrap/scss/bootstrap";</style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('BOOTSTRAP_OWNERSHIP');
        expect(ids).toContain('BOOTSTRAP_CDN_FORBIDDEN');
    } finally {
        fixture.dispose();
    }
});

test('Bootstrap CDN scripts in the document and remote imports are rejected', () => {
    const fixture = new Fixture();
    try {
        fixture.writeFrontend(
            'index.html',
            `<main id="app"></main>
             <script src="//cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>`,
        );
        fixture.write(
            'core/services/remote.service.ts',
            "import 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.esm.min.js';",
        );

        const findings = fixture.issues().filter(
            (issue) => issue.ruleId === 'BOOTSTRAP_CDN_FORBIDDEN',
        );
        expect(findings).toHaveLength(2);
        expect(findings.map((issue) => issue.location?.start.line)).toEqual([
            2,
            1,
        ]);
    } finally {
        fixture.dispose();
    }
});

test('Bootstrap global owners require one canonical complete import', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @use "bootstrap/scss/bootstrap";
             @use "bootstrap/scss/functions";`,
        );
        fixture.write(
            'main.ts',
            `import 'bootstrap';
             import 'bootstrap';
             import 'bootstrap/js/dist/modal';`,
        );

        const ownership = fixture.issues().filter(
            (issue) => issue.ruleId === 'BOOTSTRAP_OWNERSHIP',
        );
        expect(ownership).toHaveLength(2);
        expect(ownership.every((issue) =>
            issue.observed.includes('exactly once'),
        )).toBe(true);
    } finally {
        fixture.dispose();
    }
});

test('missing Bootstrap global owner files are reported without fake spans', () => {
    const fixture = new Fixture();
    try {
        fixture.remove('main.ts');
        fixture.remove('shared/styles/main.scss');

        const issues = fixture.issues();
        const script = issues.find(
            (issue) =>
                issue.ruleId === 'BOOTSTRAP_GLOBAL_SCRIPT_IMPORT_MISSING',
        );
        const style = issues.find(
            (issue) =>
                issue.ruleId === 'BOOTSTRAP_GLOBAL_STYLE_IMPORT_MISSING',
        );
        expect(script?.file).toBe('code/frontend/web/src/main.ts');
        expect(style?.file).toBe(
            'code/frontend/web/src/shared/styles/main.scss',
        );
        expect(script?.location).toBeNull();
        expect(style?.location).toBeNull();
    } finally {
        fixture.dispose();
    }
});

test('the global entrypoints must retain Bootstrap Sass and JavaScript', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            '@import "./tabler/tabler-icons.css";',
        );
        fixture.write('main.ts', 'export {};');
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('BOOTSTRAP_GLOBAL_STYLE_IMPORT_MISSING');
        expect(ids).toContain('BOOTSTRAP_GLOBAL_SCRIPT_IMPORT_MISSING');
    } finally {
        fixture.dispose();
    }
});

test('removed Pico imports and custom properties are rejected', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/legacy.scss',
            `@import "@picocss/pico";
             :root { --pico-spacing: 20px; }`,
        );
        expect(fixture.issues().map((issue) => issue.ruleId)).toContain(
            'PICO_REFERENCE_FORBIDDEN',
        );
        fixture.write(
            'core/services/legacy.service.ts',
            "import '@picocss/pico';",
        );
        const legacyScript = fixture.issues().find(
            (issue) =>
                issue.ruleId === 'PICO_REFERENCE_FORBIDDEN' &&
                issue.file.endsWith('legacy.service.ts'),
        );
        expect(legacyScript?.location?.start.line).toBe(1);
    } finally {
        fixture.dispose();
    }
});

test('the bundled Tabler icon font is owned by the global style layer', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            '@import "./tabler/tabler-icons.css";',
        );
        fixture.write(
            'presentation/desktop/views/BadView.vue',
            `<template><link href="https://cdn.example.test/tabler-icons.css"></template>
             <style scoped>@import "../../../shared/styles/tabler/tabler-icons.css";</style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('TABLER_ICON_OWNERSHIP');
        expect(ids).toContain('TABLER_ICON_CDN_FORBIDDEN');
    } finally {
        fixture.dispose();
    }
});

test('the global style layer must retain the local Tabler import', () => {
    const fixture = new Fixture();
    try {
        fixture.write('shared/styles/main.scss', ':root {}');
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('TABLER_ICON_GLOBAL_IMPORT_MISSING');
    } finally {
        fixture.dispose();
    }
});

test('font sizes and box spacing accept their strict unit contracts', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";
             :root {
                 --font-size: clamp(1rem, 2rem, 3rem);
                 --space: calc(100% - 12px);
             }
             h1 { font-size: var(--font-size, 4rem); font: inherit; }
             article {
                 margin: 0 auto;
                 padding: var(--space);
                 gap: min(10%, 24px);
                 width: 40rem;
                 line-height: 1.5;
             }`,
        );
        fixture.write(
            'presentation/desktop/components/ResetText.vue',
            `<template><p /></template>
             <style scoped>
             p { font-size: unset; margin: auto; padding: inherit; }
             </style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).not.toContain('FRONTEND_FONT_SIZE_UNIT');
        expect(ids).not.toContain('FRONTEND_FONT_SHORTHAND');
        expect(ids).not.toContain('FRONTEND_BOX_SPACING_UNIT');
        expect(ids).not.toContain('DESIGN_TOKEN_USAGE');
    } finally {
        fixture.dispose();
    }
});

test('invalid direct, token, fallback, math, and shorthand units are rejected', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";
             :root {
                 --font-size: clamp(1rem, 2vw, 3rem);
                 --space: calc(100% - 1rem);
             }
             h1 { font-size: var(--font-size, 12px); }
             article { margin: var(--space); font: 400 1rem sans-serif; }`,
        );
        fixture.write(
            'presentation/desktop/components/BadUnits.vue',
            `<template><div /></template>
             <style scoped>
             div { font-size: var(--missing); padding: 1rem; }
             </style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('FRONTEND_FONT_SIZE_UNIT');
        expect(ids).toContain('FRONTEND_FONT_SHORTHAND');
        expect(ids).toContain('FRONTEND_BOX_SPACING_UNIT');
    } finally {
        fixture.dispose();
    }
});

test('bundled Tabler CSS is excluded from application unit contracts', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";`,
        );
        fixture.write(
            'shared/styles/tabler/tabler-icons.css',
            '.ti { font-size: 16px; margin: 1rem; }',
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).not.toContain('FRONTEND_FONT_SIZE_UNIT');
        expect(ids).not.toContain('FRONTEND_BOX_SPACING_UNIT');
    } finally {
        fixture.dispose();
    }
});

test('parser failures and CLI exit codes are stable', () => {
    const valid = new Fixture();
    const invalid = new Fixture();
    try {
        valid.write('main.ts', "import 'bootstrap';");
        invalid.write('main.ts', 'export const = ;');
        const stdout = new BufferWriter();
        const stderr = new BufferWriter();
        expect(new LinterCli(valid.root, stdout, stderr).run()).toBe(0);
        expect(stdout.value).toMatch(/Frontend architecture valid/);

        expect(
            new LinterCli(
                invalid.root,
                new BufferWriter(),
                stderr,
            ).run(),
        ).toBe(2);
        expect(stderr.value).toMatch(/FRONTEND_PARSE_ERROR/);
        expect(stderr.value).toMatch(/Where: .*main\.ts:1:/);
        expect(stderr.value).toMatch(/Found: /);
        expect(stderr.value).toMatch(/Why: /);
        expect(stderr.value).toMatch(/Meaning: /);
        expect(stderr.value).toMatch(/Architecture: /);
        expect(stderr.value).toMatch(/How to fix:/);
        expect(stderr.value).toMatch(/Verify:/);
        expect(stderr.value).not.toMatch(/ARCHITECTURE\.md/);
    } finally {
        valid.dispose();
        invalid.dispose();
    }
});

test('frontend CLI emits the shared schema-version-2 JSON contract', () => {
    const fixture = new Fixture();
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();
    try {
        fixture.write('main.ts', 'export const = ;');
        expect(
            new LinterCli(
                fixture.root,
                stdout,
                stderr,
                'json',
            ).run(),
        ).toBe(2);
        const payload = JSON.parse(stdout.value) as {
            schemaVersion: number;
            issues: Array<{
                title: string;
                observed: string;
                why: string;
                meaning: string;
                context: string;
                fixSteps: string[];
                verify: string[];
            }>;
        };
        expect(stderr.value).toBe('');
        expect(payload.schemaVersion).toBe(2);
        expect(payload.issues[0].title).not.toBe('');
        expect(payload.issues[0].observed).not.toBe('');
        expect(payload.issues[0].why).not.toBe('');
        expect(payload.issues[0].meaning).not.toBe('');
        expect(payload.issues[0].context).not.toBe('');
        expect(payload.issues[0].fixSteps.length).toBeGreaterThan(0);
        expect(payload.issues[0].verify.length).toBeGreaterThan(0);
    } finally {
        fixture.dispose();
    }
});

test('TypeScript, Vue script-setup, and standalone CSS keep exact spans', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'core/models/account.model.ts',
            `export type AccountId = string;
             import { HealthService } from '../services/health.service.ts';`,
        );
        fixture.write(
            'presentation/desktop/components/HealthCard.vue',
            `<script setup lang="ts">
             import { ApiClient } from '../../../core/api/api.client.ts';
             </script>
             <template><div /></template>
             <style scoped>div { color: var(--color); }</style>`,
        );
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";
             h1 { font-size: 12px; }`,
        );
        const issues = fixture.issues();
        expect(
            issues.find(
                (issue) => issue.ruleId === 'CORE_LAYER_DIRECTION',
            )?.location?.start.line,
        ).toBe(2);
        expect(
            issues.find(
                (issue) => issue.ruleId === 'PRESENTATION_NETWORK_ACCESS',
            )?.location?.start.line,
        ).toBe(2);
        expect(
            issues.find(
                (issue) => issue.ruleId === 'FRONTEND_FONT_SIZE_UNIT',
            )?.location?.start.line,
        ).toBe(3);
    } finally {
        fixture.dispose();
    }
});

test('standalone and Vue SCSS keep exact source spans', () => {
    const fixture = new Fixture();
    try {
        fixture.write('main.ts', "import 'bootstrap';");
        fixture.write(
            'shared/styles/main.scss',
            `@use "bootstrap/scss/bootstrap";
             @import "./tabler/tabler-icons.css";
             h1 { font-size: 12px; }`,
        );
        fixture.write(
            'presentation/desktop/components/BadSpacing.vue',
            `<template><div /></template>
             <style scoped lang="scss">
             $space: 1rem;
             div { padding: $space; }
             </style>`,
        );

        const issues = fixture.issues();
        expect(issues.find(
            (issue) => issue.ruleId === 'FRONTEND_FONT_SIZE_UNIT',
        )?.location?.start.line).toBe(3);
        expect(issues.find(
            (issue) => issue.ruleId === 'FRONTEND_BOX_SPACING_UNIT',
        )?.location?.start.line).toBe(4);
    } finally {
        fixture.dispose();
    }
});
