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
        const errors: string[] = [];
        const counterPath = path.join(
            this.kanbanRoot(),
            'TASK-COUNTER.md',
        );
        let counter: number | undefined;
        try {
            counter = this.readCounter(counterPath);
        } catch (error) {
            errors.push(`${path.relative(this.projectRoot, counterPath)}:1:1 ${this.errorMessage(error)}`);
        }
        const tasks = [
            ...this.taskFiles('todo', errors),
            ...this.taskFiles('done', errors),
        ];
        const ids = new Set<number>();
        for (const task of tasks) {
            if (ids.has(task.id)) {
                errors.push(this.taskError(task, `Duplicate Kanban task ID ${task.id}.`, '**Task ID:**'));
            }
            ids.add(task.id);
            if (counter !== undefined && task.id > counter) {
                errors.push(this.taskError(task, `Task ${task.id} exceeds counter value ${counter}.`, '**Task ID:**'));
            }
            if (task.schemaVersion === 2) {
                try {
                    this.validateV2(task, task.directory === 'done');
                } catch (error) {
                    errors.push(this.errorMessage(error));
                }
            } else if (task.schemaVersion !== 1) {
                errors.push(this.taskError(task, 'Unsupported Schema Version; use 2 for new tasks or 1 for legacy tasks.', '**Schema Version:**'));
            }
        }
        const maximumId = tasks.reduce(
            (maximum, task) => Math.max(maximum, task.id),
            0,
        );
        if (counter !== undefined && counter !== maximumId) {
            errors.push(`${path.relative(this.projectRoot, counterPath)}:1:1 Kanban counter ${counter} does not match maximum task ID ${maximumId}.`);
        }
        for (const task of tasks.filter((entry) => entry.schemaVersion === 2)) {
            let dependencies: number[];
            try {
                dependencies = this.dependencies(task.content);
            } catch (error) {
                errors.push(this.taskError(task, this.errorMessage(error), '**Dependencies:**'));
                continue;
            }
            for (const dependency of dependencies) {
                if (dependency >= task.id || !ids.has(dependency)) {
                    errors.push(this.taskError(task, `Task ${task.id} has invalid dependency ${dependency}.`, '**Dependencies:**'));
                }
                if (
                    task.directory === 'done' &&
                    !tasks.some((candidate) =>
                        candidate.id === dependency &&
                        candidate.directory === 'done',
                    )
                ) {
                    errors.push(this.taskError(task, `Done task ${task.id} depends on unfinished task ${dependency}.`, '**Dependencies:**'));
                }
            }
        }
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
    }

    private validateV2(task: TaskRecord, completed: boolean): void {
        const errors: string[] = [];
        const report = (message: string, anchor?: string): void => {
            errors.push(this.taskError(task, message, anchor));
        };
        const metadata = (label: string): string => {
            const value = this.optionalMetadata(task.content, label);
            if (!value) report(`Missing '${label}' task metadata.`);
            return value ?? '';
        };
        const section = (heading: string): string => {
            try {
                return this.section(task.content, heading);
            } catch (error) {
                report(this.errorMessage(error));
                return '';
            }
        };
        if (metadata('Schema Version') !== '2') {
            report('Invalid schema version; expected 2.', '**Schema Version:**');
        }
        const domain = metadata('Domain');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(domain)) {
            report('Task domain must be kebab-case.', '**Domain:**');
        }
        const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const filePattern = new RegExp(
            `^${task.id}-${escapedDomain}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`,
            'u',
        );
        if (!filePattern.test(task.fileName)) {
            report(`Invalid Schema Version 2 filename '${task.fileName}'.`);
        }
        const metadataId = metadata('Task ID');
        const created = metadata('Created');
        const status = metadata('Status');
        if (Number(metadataId) !== task.id) {
            report(`Task ID mismatch in '${task.fileName}'.`, '**Task ID:**');
        }
        if (status !== task.directory) {
            report(`Task status mismatch in '${task.fileName}'.`, '**Status:**');
        }
        if (!this.validDate(created)) {
            report(`Invalid creation date in '${task.fileName}'.`, '**Created:**');
        }
        errors.push(...this.placeholderErrors(task, completed));
        for (const heading of ['Goal', 'Scope', 'Verification']) {
            if (!section(heading).trim()) {
                report(`Task requires a concrete ${heading} section.`, `## ${heading}`);
            }
        }
        const doneWhen = section('Done When');
        const criterionPattern = /^\s*- \[([ xX])\] .+$/u;
        const checkboxLines = doneWhen.split(/\r?\n/u).filter((line) =>
            /^\s*- \[/u.test(line),
        );
        if (checkboxLines.some((line) => !criterionPattern.test(line))) {
            report(`Task '${task.fileName}' has invalid checkboxes.`, '## Done When');
        }
        const criteria = checkboxLines.filter((line) =>
            criterionPattern.test(line),
        );
        if (criteria.length === 0) {
            report(`Task '${task.fileName}' has no Done When criteria.`, '## Done When');
        }
        if (completed && criteria.some((line) => !/\[[xX]\]/u.test(line))) {
            report(`Task '${task.fileName}' has unchecked criteria.`, '## Done When');
        }
        if (completed) {
            const evidence = section('Completion Notes');
            for (let index = 1; index <= criteria.length; index += 1) {
                const pattern = new RegExp(
                    '^\\s*- Criterion ' + index + ': `([^`\\r\\n]+)`$',
                    'mu',
                );
                const value = evidence.match(pattern)?.[1]?.trim();
                if (!value || /^<[^>]+>$/u.test(value)) {
                    report(
                        `Task '${task.fileName}' lacks evidence for criterion ${index}.`,
                        evidence.includes(`- Criterion ${index}:`)
                            ? `- Criterion ${index}:` : '## Completion Notes',
                    );
                }
            }
        }
        if (errors.length > 0) throw new Error(errors.join('\n'));
    }

    private taskFiles(directory: 'todo' | 'done', errors?: string[]): TaskRecord[] {
        const directoryPath = path.join(this.kanbanRoot(), directory);
        if (!fs.existsSync(directoryPath)) {
            if (errors) {
                errors.push(`${path.relative(this.projectRoot, directoryPath)}: Missing Kanban directory '${directory}'.`);
                return [];
            }
            throw new Error(`Missing Kanban directory '${directory}'.`);
        }
        return fs.readdirSync(directoryPath, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
            .sort((left, right) => left.name.localeCompare(right.name))
            .flatMap((entry): TaskRecord[] => {
                const filePath = path.join(directoryPath, entry.name);
                const content = fs.readFileSync(filePath, 'utf8');
                const idMatch = entry.name.match(/^(\d+)-/u);
                if (!idMatch) {
                    if (errors) {
                        errors.push(`${path.relative(this.projectRoot, filePath)}: Invalid task filename '${entry.name}'.`);
                        return [];
                    }
                    throw new Error(`Invalid task filename '${entry.name}'.`);
                }
                return [{
                    fileName: entry.name,
                    filePath,
                    directory,
                    content,
                    id: Number(idMatch[1]),
                    schemaVersion: Number(
                        this.optionalMetadata(content, 'Schema Version') ?? 1,
                    ),
                }];
            });
    }

    /** Only explicit draft markers and the frozen legacy template tokens are placeholders. */
    private placeholderErrors(task: TaskRecord, completed: boolean): string[] {
        const legacyTokens = [
            '<Title>', '<counter>', '<domain>', '<YYYY-MM-DD>',
            '<One sentence describing the concrete outcome and why it is needed.>',
            '<Relevant architecture constraints and affected modules. Remove this section if unnecessary.>',
            '<Required change>', '<Explicitly excluded behavior or area>',
            '<Concrete and independently verifiable criterion>',
            '<exact test name or verification command>', '<Concise implementation summary.>',
        ];
        const errors: string[] = [];
        let heading = '';
        for (const [index, line] of task.content.split(/\r?\n/u).entries()) {
            if (line.startsWith('## ')) heading = line.slice(3).trim();
            if (!completed && heading === 'Completion Notes') continue;
            const explicit = /\[\[TODO(?::[^\]\r\n]*)?\]\]|<(?:TBD|TODO)(?:\s[^>\r\n]*)?>/gu;
            const matches = [...line.matchAll(explicit)].map((match) => ({
                text: match[0], column: match.index + 1,
            }));
            for (const token of legacyTokens) {
                let column = line.indexOf(token);
                while (column !== -1) {
                    matches.push({ text: token, column: column + 1 });
                    column = line.indexOf(token, column + token.length);
                }
            }
            for (const match of matches.sort((left, right) => left.column - right.column)) {
                errors.push(`${path.relative(this.projectRoot, task.filePath)}:${index + 1}:${match.column} Unresolved placeholder ${JSON.stringify(match.text)}. Replace it with concrete task content${completed ? ' or actual completion evidence' : '; completion evidence is only required when closing the task'}.`);
            }
        }
        return errors;
    }

    private taskError(task: TaskRecord, message: string, anchor?: string): string {
        const index = anchor ? task.content.indexOf(anchor) : -1;
        const location = index < 0 ? '' : `:${task.content.slice(0, index).split('\n').length}:1`;
        return `${path.relative(this.projectRoot, task.filePath)}${location} ${message}`;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
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
