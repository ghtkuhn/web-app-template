import fs from 'node:fs';
import path from 'node:path';

interface TaskRecord {
    readonly fileName: string;
    readonly filePath: string;
    readonly directory: 'todo' | 'done';
    readonly content: string;
    readonly id: number;
    readonly schemaVersion: number;
}

/** Owns project Memory initialization and deterministic Kanban transitions. */
export class WorkflowManager {
    private readonly projectRoot: string;

    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /** Creates missing workflow state without replacing application content. */
    public initialize(): void {
        const aiRoot = path.join(this.projectRoot, 'data/ai');
        fs.mkdirSync(path.join(aiRoot, 'kanban/todo'), { recursive: true });
        fs.mkdirSync(path.join(aiRoot, 'kanban/done'), { recursive: true });
        const memory = path.join(aiRoot, 'MEMORY.md');
        try {
            fs.writeFileSync(
                memory,
                '# Project Memory\n\n' +
                    'Store only current, durable invariants and gotchas here. ' +
                    'Replace stale claims instead of appending test or release logs.\n',
                { flag: 'wx', mode: 0o644 },
            );
        } catch (error) {
            if (!this.hasCode(error, 'EEXIST')) {
                throw error;
            }
        }
    }

    /** Atomically reserves the next task identifier and creates its draft. */
    public createTask(domain: string, slug: string): string {
        this.assertKebabCase(domain, 'domain');
        this.assertKebabCase(slug, 'slug');
        this.initialize();
        const kanbanRoot = this.kanbanRoot();
        const lockPath = path.join(kanbanRoot, '.task-counter.lock');
        const lock = fs.openSync(lockPath, 'wx');
        try {
            const counterPath = path.join(kanbanRoot, 'TASK-COUNTER.md');
            const counter = this.readCounter(counterPath);
            const id = counter + 1;
            const fileName = `${id}-${domain}-${slug}.md`;
            const filePath = path.join(kanbanRoot, 'todo', fileName);
            const template = fs.readFileSync(
                path.join(kanbanRoot, 'TASK-TEMPLATE.md'),
                'utf8',
            );
            const title = slug
                .split('-')
                .map((part, index) => index === 0
                    ? `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`
                    : part)
                .join(' ');
            const content = template
                .replace('<Title>', title)
                .replace('<counter>', String(id))
                .replace('<domain>', domain)
                .replace('<YYYY-MM-DD>', new Date().toISOString().slice(0, 10));
            fs.writeFileSync(filePath, content, { flag: 'wx' });
            this.atomicWrite(counterPath, `${id}\n`);
            return path.relative(this.projectRoot, filePath);
        } finally {
            fs.closeSync(lock);
            fs.unlinkSync(lockPath);
        }
    }

    /** Validates a completed v2 task and moves it to immutable history. */
    public closeTask(rawId: string): string {
        if (!/^[1-9][0-9]*$/u.test(rawId)) {
            throw new Error(`Invalid task ID '${rawId}'.`);
        }
        const id = Number(rawId);
        const todo = this.taskFiles('todo').filter((task) => task.id === id);
        if (todo.length !== 1) {
            throw new Error(`Expected exactly one todo task with ID ${id}.`);
        }
        const task = todo[0] as TaskRecord;
        if (task.schemaVersion !== 2) {
            throw new Error('Only Schema Version 2 tasks can be closed.');
        }
        this.validateV2(task, true);
        const tasks = [
            ...this.taskFiles('todo'),
            ...this.taskFiles('done'),
        ];
        for (const dependency of this.dependencies(task.content)) {
            if (!tasks.some((candidate) =>
                candidate.id === dependency && candidate.directory === 'done',
            )) {
                throw new Error(
                    `Task ${task.id} depends on unfinished task ${dependency}.`,
                );
            }
        }
        const completed = task.content.replace(
            /^\*\*Status:\*\* todo$/mu,
            '**Status:** done',
        );
        const destination = path.join(
            this.kanbanRoot(),
            'done',
            task.fileName,
        );
        if (fs.existsSync(destination)) {
            throw new Error(`Done task '${task.fileName}' already exists.`);
        }
        this.atomicWrite(task.filePath, completed);
        fs.renameSync(task.filePath, destination);
        return path.relative(this.projectRoot, destination);
    }

    /** Validates task identity, state, dependencies, and completion evidence. */
    public checkKanban(): void {
        const counter = this.readCounter(path.join(
            this.kanbanRoot(),
            'TASK-COUNTER.md',
        ));
        const tasks = [
            ...this.taskFiles('todo'),
            ...this.taskFiles('done'),
        ];
        const ids = new Set<number>();
        for (const task of tasks) {
            if (ids.has(task.id)) {
                throw new Error(`Duplicate Kanban task ID ${task.id}.`);
            }
            ids.add(task.id);
            if (task.id > counter) {
                throw new Error(
                    `Task ${task.id} exceeds counter value ${counter}.`,
                );
            }
            if (task.schemaVersion === 2) {
                this.validateV2(task, task.directory === 'done');
            }
        }
        const maximumId = tasks.reduce(
            (maximum, task) => Math.max(maximum, task.id),
            0,
        );
        if (counter !== maximumId) {
            throw new Error(
                `Kanban counter ${counter} does not match maximum task ID ${maximumId}.`,
            );
        }
        for (const task of tasks.filter((entry) => entry.schemaVersion === 2)) {
            for (const dependency of this.dependencies(task.content)) {
                if (dependency >= task.id || !ids.has(dependency)) {
                    throw new Error(
                        `Task ${task.id} has invalid dependency ${dependency}.`,
                    );
                }
                if (
                    task.directory === 'done' &&
                    !tasks.some((candidate) =>
                        candidate.id === dependency &&
                        candidate.directory === 'done',
                    )
                ) {
                    throw new Error(
                        `Done task ${task.id} depends on unfinished task ${dependency}.`,
                    );
                }
            }
        }
    }

    private validateV2(task: TaskRecord, completed: boolean): void {
        if (this.metadata(task.content, 'Schema Version') !== '2') {
            throw new Error(`Invalid schema version in '${task.fileName}'.`);
        }
        const domain = this.metadata(task.content, 'Domain');
        this.assertKebabCase(domain, 'Task domain');
        const filePattern = new RegExp(
            `^${task.id}-${domain}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`,
            'u',
        );
        if (!filePattern.test(task.fileName)) {
            throw new Error(`Invalid Schema Version 2 filename '${task.fileName}'.`);
        }
        const metadataId = this.metadata(task.content, 'Task ID');
        const created = this.metadata(task.content, 'Created');
        const status = this.metadata(task.content, 'Status');
        if (Number(metadataId) !== task.id) {
            throw new Error(`Task ID mismatch in '${task.fileName}'.`);
        }
        if (status !== task.directory) {
            throw new Error(`Task status mismatch in '${task.fileName}'.`);
        }
        if (!this.validDate(created)) {
            throw new Error(`Invalid creation date in '${task.fileName}'.`);
        }
        if (/<[^>\n]+>/u.test(task.content)) {
            throw new Error(`Unresolved placeholder in '${task.fileName}'.`);
        }
        const doneWhen = this.section(task.content, 'Done When');
        const criterionPattern = /^\s*- \[([ xX])\] .+$/u;
        const checkboxLines = doneWhen.split(/\r?\n/u).filter((line) =>
            /^\s*- \[/u.test(line),
        );
        if (checkboxLines.some((line) => !criterionPattern.test(line))) {
            throw new Error(`Task '${task.fileName}' has invalid checkboxes.`);
        }
        const criteria = checkboxLines.filter((line) =>
            criterionPattern.test(line),
        );
        if (criteria.length === 0) {
            throw new Error(`Task '${task.fileName}' has no Done When criteria.`);
        }
        if (completed && criteria.some((line) => !/\[[xX]\]/u.test(line))) {
            throw new Error(`Task '${task.fileName}' has unchecked criteria.`);
        }
        if (completed) {
            const evidence = this.section(task.content, 'Completion Notes');
            for (let index = 1; index <= criteria.length; index += 1) {
                const pattern = new RegExp(
                    '^\\s*- Criterion ' + index + ': `[^`]+`$',
                    'mu',
                );
                if (!pattern.test(evidence)) {
                    throw new Error(
                        `Task '${task.fileName}' lacks evidence for criterion ${index}.`,
                    );
                }
            }
        }
    }

    private taskFiles(directory: 'todo' | 'done'): TaskRecord[] {
        const directoryPath = path.join(this.kanbanRoot(), directory);
        if (!fs.existsSync(directoryPath)) {
            throw new Error(`Missing Kanban directory '${directory}'.`);
        }
        return fs.readdirSync(directoryPath, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => {
                const filePath = path.join(directoryPath, entry.name);
                const content = fs.readFileSync(filePath, 'utf8');
                const idMatch = entry.name.match(/^(\d+)-/u);
                if (!idMatch) {
                    throw new Error(`Invalid task filename '${entry.name}'.`);
                }
                return {
                    fileName: entry.name,
                    filePath,
                    directory,
                    content,
                    id: Number(idMatch[1]),
                    schemaVersion: Number(
                        this.optionalMetadata(content, 'Schema Version') ?? 1,
                    ),
                };
            });
    }

    private dependencies(content: string): number[] {
        const value = this.metadata(content, 'Dependencies');
        if (value === 'none') {
            return [];
        }
        if (!/^[1-9][0-9]*(?:, [1-9][0-9]*)*$/u.test(value)) {
            throw new Error(`Invalid task dependencies '${value}'.`);
        }
        return value.split(', ').map(Number);
    }

    private metadata(content: string, label: string): string {
        const value = this.optionalMetadata(content, label);
        if (!value) {
            throw new Error(`Missing '${label}' task metadata.`);
        }
        return value;
    }

    private optionalMetadata(content: string, label: string): string | undefined {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return content.match(
            new RegExp(`^\\*\\*${escaped}:\\*\\* (.+)$`, 'mu'),
        )?.[1]?.trim();
    }

    private section(content: string, heading: string): string {
        const lines = content.split(/\r?\n/u);
        const start = lines.findIndex((line) => line === `## ${heading}`);
        if (start < 0) {
            throw new Error(`Missing '${heading}' task section.`);
        }
        const next = lines.findIndex(
            (line, index) => index > start && line.startsWith('## '),
        );
        return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n');
    }

    private readCounter(counterPath: string): number {
        const value = fs.readFileSync(counterPath, 'utf8').trim();
        if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
            throw new Error('TASK-COUNTER.md must contain one non-negative integer.');
        }
        return Number(value);
    }

    private atomicWrite(target: string, content: string): void {
        const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporary, content, { flag: 'wx' });
        fs.renameSync(temporary, target);
    }

    private assertKebabCase(value: string, label: string): void {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
            throw new Error(`${label} must be kebab-case.`);
        }
    }

    private validDate(value: string): boolean {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
            return false;
        }
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.valueOf()) &&
            date.toISOString().slice(0, 10) === value;
    }

    private kanbanRoot(): string {
        return path.join(this.projectRoot, 'data/ai/kanban');
    }

    private hasCode(error: unknown, code: string): boolean {
        return error instanceof Error &&
            'code' in error &&
            error.code === code;
    }
}
