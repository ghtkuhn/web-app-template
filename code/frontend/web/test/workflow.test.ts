import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
