import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
);

test('agent instructions document the curated root quality commands', () => {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const agents = fs.readFileSync(
        path.join(projectRoot, 'AGENTS.md'),
        'utf8',
    );
    const groups = [
        {
            title: 'Complete Verification',
            commands: [
                ['runtime:check', 'npm run runtime:check',
                    'Checks the pinned Node.js and npm contract.'],
                ['verify', 'npm run verify',
                    'Runs the complete required quality pipeline.'],
                ['audit', 'npm run audit',
                    'Checks for newly introduced code-health findings with the locally pinned Fallow.'],
            ],
        },
        {
            title: 'Focused Quality Checks',
            commands: [
                ['lint', 'npm run lint',
                    'Checks architecture, styles, and OpenAPI across all workspaces.'],
                ['typecheck', 'npm run typecheck',
                    'Typechecks root tooling and all workspaces.'],
                ['test', 'npm run test',
                    'Runs workspace unit, integration, and component tests.'],
                ['build', 'npm run build',
                    'Builds every workspace that defines a build script.'],
                ['verify:module', 'npm run verify:module -- <module>',
                    "Runs backend-wide type and lint checks plus the module's direct tests."],
            ],
        },
        {
            title: 'Generated Contracts',
            commands: [
                ['check:api', 'npm run check:api',
                    'Checks backend OpenAPI and generated frontend types.'],
                ['generate:api', 'npm run generate:api',
                    'Updates backend OpenAPI and generated frontend types.'],
                ['check:modules', 'npm run check:modules',
                    'Checks generated module mechanics for drift.'],
                ['module:sync', 'npm run module:sync -- <module>',
                    "Updates one module's generated mechanics."],
                ['check:migrations', 'npm run check:migrations',
                    'Checks migration order, dialect pairs, catalog, and checksums.'],
                ['generate:migrations', 'npm run generate:migrations',
                    'Updates the migration checksum catalog.'],
                ['check:test-catalog', 'npm run check:test-catalog',
                    'Checks the backend test catalog for drift.'],
                ['generate:test-catalog', 'npm run generate:test-catalog',
                    'Updates the backend test catalog.'],
            ],
        },
    ] as const;
    const expected = groups.map(({ title, commands }) => [
        `### ${title}`,
        '',
        ...commands.map(([, usage, description]) =>
            `* \`${usage}\`: ${description}`,
        ),
    ].join('\n')).join('\n\n');
    const section = agents.match(
        /## Root npm Scripts\n\n([\s\S]*?)\n\n---/u,
    )?.[1];

    expect(section?.trimEnd()).toBe(expected);
    for (const { commands } of groups) {
        for (const [script] of commands) {
            expect(packageJson.scripts).toHaveProperty(script);
        }
    }
    for (const excluded of [
        'credentials:',
        'deployment:',
        'icons',
        'scaffold:',
        'task:',
        'template:',
        'workflow:',
    ]) {
        expect(section).not.toContain(`npm run ${excluded}`);
    }
});

test('canonical agent instructions own the basis and delegate project rules', () => {
    const agents = fs.readFileSync(
        path.join(projectRoot, 'AGENTS.md'),
        'utf8',
    );

    expect(fs.existsSync(
        path.join(projectRoot, 'AGENTS-DEFAULT.md'),
    )).toBe(false);
    expect(agents).toContain(
        'You must read the file contents of `AGENTS-PROJECT.md`',
    );
    expect(agents).toContain(
        '`AGENTS-PROJECT.md` always take priority over any rule written in this file',
    );
    expect(agents).toContain(
        '`AGENTS.md` is template-owned and replaced by every update',
    );
});
