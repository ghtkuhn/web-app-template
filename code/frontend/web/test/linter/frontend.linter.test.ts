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

    public write(relativePath: string, source: string): void {
        const filePath = path.join(
            this.root,
            'code/frontend/web/src',
            relativePath,
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
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
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('PRESENTATION_CROSS_IMPORT');
        expect(ids).toContain('PRESENTATION_NETWORK_ACCESS');
        expect(ids).toContain('PRESENTATION_STYLE_SCOPE');
        expect(ids).toContain('PRESENTATION_MEDIA_QUERY');
        expect(ids).toContain('VUE_SCRIPT_SETUP');
        expect(ids).toContain('PRESENTATION_VIEW_PARITY');
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

test('Pico CSS is owned by the global style layer and may not use a CDN', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.css',
            '@import "@picocss/pico";',
        );
        fixture.write(
            'presentation/desktop/views/BadView.vue',
            `<template><link href="https://picocss.com/pico.min.css"></template>
             <style scoped>@import "@picocss/pico";</style>`,
        );
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('PICO_OWNERSHIP');
        expect(ids).toContain('PICO_CDN_FORBIDDEN');
    } finally {
        fixture.dispose();
    }
});

test('the global style layer must retain the Pico import', () => {
    const fixture = new Fixture();
    try {
        fixture.write('shared/styles/main.css', ':root {}');
        const ids = fixture.issues().map((issue) => issue.ruleId);
        expect(ids).toContain('PICO_GLOBAL_IMPORT_MISSING');
    } finally {
        fixture.dispose();
    }
});

test('the bundled Tabler icon font is owned by the global style layer', () => {
    const fixture = new Fixture();
    try {
        fixture.write(
            'shared/styles/main.css',
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
        fixture.write('shared/styles/main.css', ':root {}');
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
            'shared/styles/main.css',
            `@import "@picocss/pico";
             @import "./tabler/tabler-icons.css";
             :root {
                 --font-size: clamp(1rem, 2rem, 3rem);
                 --space: calc(100% - 12px);
                 --pico-spacing: var(--space);
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
            'shared/styles/main.css',
            `@import "@picocss/pico";
             @import "./tabler/tabler-icons.css";
             :root {
                 --font-size: clamp(1rem, 2vw, 3rem);
                 --space: calc(100% - 1rem);
                 --pico-spacing: var(--space);
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
            'shared/styles/main.css',
            `@import "@picocss/pico";
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
        valid.write('main.ts', 'export {};');
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
    } finally {
        valid.dispose();
        invalid.dispose();
    }
});
