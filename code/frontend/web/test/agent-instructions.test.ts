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

test('verification policy is independent of Kanban and shares evidence across agents', () => {
    const agents = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    const section = agents.match(/# Verification Rules\n([\s\S]*?)(?=\n---)/u)?.[1];
    expect(section).toBeDefined();
    for (const requirement of [
        'whether or not Kanban is enabled',
        'explicit user requests for additional checks remain binding',
        'including existing regression tests when affected',
        'It already includes the full test suite',
        'Documentation-only changes require only affected contract checks',
        'Task boundaries, agent changes, context loss, commits, pushes, release creation, and Completion Notes edits alone must not trigger another full Verify',
        'After small corrections, rerun only affected tests and checks',
        'dependency/runtime contract changes',
        'state the concrete reason before repeating it',
        'Reuse successful unaffected stages',
        'Keep the original run recorded as failed',
        'every required stage to have valid passing evidence',
        'tested commit or described worktree state',
        'existing log paths when available',
        'Do not create a separate verification report or cache',
        'successful automatic post-update Verify counts',
    ]) {
        expect(section).toContain(requirement);
    }
    const kanban = agents.match(/# Kanban Rules\n([\s\S]*?)(?=\n---)/u)?.[1];
    expect(kanban).toContain('[Verification Rules](#verification-rules)');
    expect(kanban).toContain('satisfied by recorded results');
    expect(kanban).not.toContain('npm run verify');
});

test('task and updater instructions defer to the shared verification policy', () => {
    const agents = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    const template = fs.readFileSync(
        path.join(projectRoot, 'data/ai/kanban/TASK-TEMPLATE.md'), 'utf8',
    );
    const updates = fs.readFileSync(path.join(projectRoot, 'TEMPLATE-UPDATES.md'), 'utf8');
    expect(template).toContain('AGENTS.md#verification-rules');
    expect(template).toContain('small corrections require focused rechecks');
    expect(template).toContain('tested commit or described worktree state');
    expect(updates).toContain('[Verification Rules](AGENTS.md#verification-rules)');
    expect(updates).toContain('retain successful unaffected stage results');
    expect(updates).toContain('targeted recovery does not change their status');
    expect(updates).toContain('automatic post-update Verify counts');
    for (const obsolete of [
        'run the complete existing test suite and root `npm run verify`',
        'run only tests created or changed by the current task',
        'run `npm run verify` again',
        'After the final open task in an implementation sequence, run `npm run verify` once.',
        'the template update, and run full verification',
    ]) {
        expect([agents, template, updates].join('\n')).not.toContain(obsolete);
    }
});
