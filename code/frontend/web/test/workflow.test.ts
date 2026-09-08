import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { WorkflowManager } from '../../../../script/workflow/workflow.manager.ts';

const roots: string[] = [];
const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
);

function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-'));
    roots.push(root);
    const kanban = path.join(root, 'data/ai/kanban');
    fs.mkdirSync(kanban, { recursive: true });
    fs.copyFileSync(
        path.join(projectRoot, 'data/ai/kanban/TASK-TEMPLATE.md'),
        path.join(kanban, 'TASK-TEMPLATE.md'),
    );
    fs.writeFileSync(path.join(kanban, 'TASK-COUNTER.md'), '4\n');
    return root;
}

function completedTask(id: number): string {
    return [
        '# Task: Safe workflow',
        '',
        '**Schema Version:** 2',
        `**Task ID:** ${id}`,
        '**Domain:** infra',
        '**Created:** 2026-08-14',
        '**Status:** todo',
        '**Dependencies:** none',
        '',
        '## Goal',
        '',
        'Provide a deterministic workflow.',
        '',
        '## Scope',
        '',
        '- Validate Kanban task transitions.',
        '',
        '## Verification',
        '',
        'Run `npm test -- workflow.test.ts`.',
        '',
        '## Done When',
        '',
        '- [x] The focused test passes.',
        '',
        '## Completion Notes',
        '',
        '- Criterion 1: `npm test -- workflow.test.ts`',
        '',
        'Implemented and verified.',
        '',
    ].join('\n');
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('open tasks allow pending completion notes but closing requires real evidence', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    const task = path.join(root, 'data/ai/kanban/todo/4-infra-safe-workflow.md');
    const content = completedTask(4).replace(
        '- Criterion 1: `npm test -- workflow.test.ts`',
        '- Criterion 1: `<TBD after implementation>`\n<Concise implementation summary.>',
    );
    fs.writeFileSync(task, content);
    expect(() => manager.checkKanban()).not.toThrow();
    expect(() => manager.closeTask('4')).toThrow(/Unresolved placeholder/);
    expect(fs.readFileSync(task, 'utf8')).toBe(content);
    expect(fs.readdirSync(path.join(root, 'data/ai/kanban/done'))).toEqual([]);
    fs.writeFileSync(task, content.slice(0, content.indexOf('## Completion Notes')));
    expect(() => manager.checkKanban()).not.toThrow();
    expect(() => manager.closeTask('4')).toThrow(/Completion Notes/);
});

test('code examples, HTML, generics, autolinks and CLI arguments are not placeholders', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    fs.writeFileSync(path.join(root, 'data/ai/kanban/todo/4-infra-safe-workflow.md'),
        completedTask(4) + '\n```ts\nconst result: Promise<void> = run();\n```\n' +
        '`<div>` and `<custom-element>`; `Map<string, number>`.\n' +
        '<https://example.com> and `npm run verify:module -- <module>`.\n');
    expect(() => manager.checkKanban()).not.toThrow();
    manager.closeTask('4');
    expect(() => manager.checkKanban()).not.toThrow();
});

test('Kanban reports every draft marker in every task with exact line and column', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    for (const id of [3, 4]) {
        fs.writeFileSync(path.join(root, `data/ai/kanban/todo/${id}-infra-safe-workflow.md`),
            completedTask(id).replace('Provide a deterministic workflow.',
                '<TBD after implementation>\n[[TODO: Define goal]]\n<Required change>'));
    }
    let message = '';
    try { manager.checkKanban(); } catch (error) {
        message = (error as Error).message;
    }
    for (const id of [3, 4]) {
        expect(message).toContain(`${id}-infra-safe-workflow.md:12:1 Unresolved placeholder "<TBD after implementation>"`);
        expect(message).toContain(`${id}-infra-safe-workflow.md:13:1 Unresolved placeholder "[[TODO: Define goal]]"`);
        expect(message).toContain(`${id}-infra-safe-workflow.md:14:1 Unresolved placeholder "<Required change>"`);
    }
    expect(message.match(/Unresolved placeholder/g)).toHaveLength(6);
});

test('new template drafts require planning content but not completed implementation', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    const task = path.join(root, manager.createTask('infra', 'safe-workflow'));
    expect(() => manager.checkKanban()).toThrow(/Unresolved placeholder/);
    const draft = fs.readFileSync(task, 'utf8');
    const [planning, notes] = draft.split('## Completion Notes');
    fs.writeFileSync(task, planning!.replace(/\[\[TODO:[^\]]*\]\]/gu,
        'Verify task transitions with `npm test -- workflow.test.ts`.') +
        '## Completion Notes' + notes);
    expect(() => manager.checkKanban()).not.toThrow();
    expect(() => manager.closeTask('5')).toThrow(/Unresolved placeholder/);
});

test('Kanban aggregates malformed filenames, metadata, dependencies and criteria', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    const todo = path.join(root, 'data/ai/kanban/todo');
    fs.writeFileSync(path.join(todo, 'invalid.md'), 'invalid task');
    fs.writeFileSync(path.join(todo, '3-infra-safe-workflow.md'), completedTask(3)
        .replace('**Created:** 2026-08-14', '**Created:** invalid')
        .replace('**Dependencies:** none', '**Dependencies:** invalid')
        .replace('- [x]', '- [?]'));
    fs.writeFileSync(path.join(todo, '4-infra-safe-workflow.md'), completedTask(4)
        .replace('**Task ID:** 4', '**Task ID:** 99')
        .replace('**Status:** todo', '**Status:** done'));
    let message = '';
    try { manager.checkKanban(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('Invalid task filename');
    expect(message).toContain('Invalid creation date');
    expect(message).toContain('Invalid task dependencies');
    expect(message).toContain('invalid checkboxes');
    expect(message).toContain('Task ID mismatch');
    expect(message).toContain('Task status mismatch');
});

test('pending markers in done notes are rejected and notes do not hide later planning markers', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    fs.writeFileSync(path.join(root, 'data/ai/kanban/done/4-infra-safe-workflow.md'),
        completedTask(4).replace('**Status:** todo', '**Status:** done') +
        '\n[[TODO: Summarize results]]\n');
    expect(() => manager.checkKanban()).toThrow(/Summarize results/);
    fs.unlinkSync(path.join(root, 'data/ai/kanban/done/4-infra-safe-workflow.md'));
    fs.writeFileSync(path.join(root, 'data/ai/kanban/todo/4-infra-safe-workflow.md'),
        completedTask(4) + '\n## Additional Scope\n[[TODO: Decide scope]]\n');
    expect(() => manager.checkKanban()).toThrow(/Decide scope/);
});

test('completion evidence cannot be blank or a stand-alone angle-bracket placeholder', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    const file = path.join(root, 'data/ai/kanban/todo/4-infra-safe-workflow.md');
    for (const value of ['   ', '<config-test-name>']) {
        fs.writeFileSync(file, completedTask(4).replace('`npm test -- workflow.test.ts`', `\`${value}\``)
            .replace('- Criterion 1: `npm test -- workflow.test.ts`', `- Criterion 1: \`${value}\``));
        expect(() => manager.checkKanban()).not.toThrow();
        expect(() => manager.closeTask('4')).toThrow(/lacks evidence for criterion 1/);
    }
});

test('check:kanban CLI prints all task failures with exit code 1 and succeeds after repair', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    fs.mkdirSync(path.join(root, 'script/workflow'), { recursive: true });
    for (const file of ['script/workflow.ts', 'script/workflow/workflow.manager.ts']) {
        fs.copyFileSync(path.join(projectRoot, file), path.join(root, file));
    }
    const files = [3, 4].map((id) => ({
        file: path.join(root, `data/ai/kanban/todo/${id}-infra-safe-workflow.md`), id,
    }));
    for (const { file, id } of files) {
        fs.writeFileSync(file, completedTask(id).replace('Provide a deterministic workflow.',
            '[[TODO: Define the task goal]]'));
    }
    const run = () => spawnSync(process.execPath, ['script/workflow.ts', 'check:kanban'], {
        cwd: root, encoding: 'utf8',
    });
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('3-infra-safe-workflow.md:12:1');
    expect(failed.stderr).toContain('4-infra-safe-workflow.md:12:1');
    expect(failed.stdout).not.toContain('Kanban metadata is valid');
    for (const { file, id } of files) fs.writeFileSync(file, completedTask(id));
    const passed = run();
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain('Kanban metadata is valid.');
    expect(passed.stderr).toBe('');
});

test('workflow initialization preserves Memory and creates Kanban folders', () => {
    const root = fixture();
    const manager = new WorkflowManager(root);
    manager.initialize();
    fs.writeFileSync(path.join(root, 'data/ai/MEMORY.md'), 'durable');

    manager.initialize();

    expect(fs.readFileSync(path.join(root, 'data/ai/MEMORY.md'), 'utf8'))
        .toBe('durable');
    expect(fs.statSync(path.join(root, 'data/ai/kanban/todo')).isDirectory())
        .toBe(true);
});

test('task creation reserves the next ID and renders v2 metadata', () => {
    const root = fixture();

    const relativePath = new WorkflowManager(root).createTask(
        'backend',
        'scoped-store',
    );

    expect(relativePath).toBe(
        'data/ai/kanban/todo/5-backend-scoped-store.md',
    );
    expect(fs.readFileSync(
        path.join(root, 'data/ai/kanban/TASK-COUNTER.md'),
        'utf8',
    )).toBe('5\n');
    expect(fs.readFileSync(path.join(root, relativePath), 'utf8'))
        .toContain('**Schema Version:** 2');
});

test('task closing requires evidence and moves a valid task', () => {
    const root = fixture();
    const todo = path.join(root, 'data/ai/kanban/todo');
    fs.mkdirSync(todo, { recursive: true });
    fs.mkdirSync(path.join(root, 'data/ai/kanban/done'), { recursive: true });
    fs.writeFileSync(
        path.join(todo, '4-infra-safe-workflow.md'),
        completedTask(4),
    );

    const result = new WorkflowManager(root).closeTask('4');

    expect(result).toBe('data/ai/kanban/done/4-infra-safe-workflow.md');
    expect(fs.readFileSync(path.join(root, result), 'utf8'))
        .toContain('**Status:** done');
});

test('Kanban check accepts legacy v1 and rejects incomplete v2 done tasks', () => {
    const root = fixture();
    const done = path.join(root, 'data/ai/kanban/done');
    fs.mkdirSync(done, { recursive: true });
    fs.mkdirSync(path.join(root, 'data/ai/kanban/todo'), { recursive: true });
    fs.writeFileSync(path.join(done, '3-backend-legacy.md'), 'legacy v1');
    fs.writeFileSync(
        path.join(done, '4-infra-safe-workflow.md'),
        completedTask(4)
            .replace('**Status:** todo', '**Status:** done')
            .replace('- [x]', '- [ ]'),
    );

    expect(() => new WorkflowManager(root).checkKanban())
        .toThrow(/unchecked criteria/);
});

test('Kanban check rejects counter drift and forward dependencies', () => {
    const root = fixture();
    const todo = path.join(root, 'data/ai/kanban/todo');
    fs.mkdirSync(todo, { recursive: true });
    fs.mkdirSync(path.join(root, 'data/ai/kanban/done'), { recursive: true });
    fs.writeFileSync(
        path.join(todo, '4-infra-safe-workflow.md'),
        completedTask(4).replace('**Dependencies:** none', '**Dependencies:** 5'),
    );

    expect(() => new WorkflowManager(root).checkKanban())
        .toThrow(/invalid dependency 5/);
    fs.writeFileSync(
        path.join(todo, '4-infra-safe-workflow.md'),
        completedTask(4),
    );
    fs.writeFileSync(path.join(root, 'data/ai/kanban/TASK-COUNTER.md'), '5\n');
    expect(() => new WorkflowManager(root).checkKanban())
        .toThrow(/does not match maximum task ID/);
});
