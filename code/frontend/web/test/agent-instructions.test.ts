import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
);

test('agent instructions expose only the eight daily command entries', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts;
    const agents = fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8');
    const section = agents.split('## Root npm Scripts')[1]?.split('\n---')[0];
    const names = [...(section ?? '').matchAll(/^\* `npm run ([a-z:]+)/gmu)].map((match) => match[1]);
    expect(names).toEqual(['code:inspect', 'code:trace', 'scaffold', 'lint', 'typecheck', 'test', 'verify', 'help']);
    for (const name of names) expect(scripts).toHaveProperty(name);
    expect(section).toContain('--module <module> | --file <file-path>');
    expect(section).toContain('npm run help -- scaffold <type>');
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
        'reuse valid results across tasks, agents, updates, and releases',
        'recheck only affected stages',
        'passing evidence for every required stage',
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
    expect(agents).toContain('select tests by concrete failure risk and impact');
    expect(agents).toContain('You may add no new test if you document the reason');
    for (const heading of ['Testing Rules', 'Verification Rules']) {
        const section = agents.split(`# ${heading}\n`)[1]?.split('\n---')[0];
        const rules = section?.split('\n').filter((line) => line.startsWith('* '));
        expect(rules?.length).toBeGreaterThan(0);
        for (const rule of rules ?? []) {
            expect(rule).toMatch(/^\* You (?:must not|must|should|may) /u);
        }
    }
    expect(template).toContain('AGENTS.md#testing-rules');
    for (const document of [template, updates]) {
        expect(document).toContain('“No new test” is valid');
        expect(document).toContain('reason and existing test or check evidence');
    }
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
