import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowManager } from './workflow/workflow.manager.ts';

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);
const [command, ...args] = process.argv.slice(2);
const workflow = new WorkflowManager(projectRoot);

try {
    if (command === 'init') {
        workflow.initialize();
        console.log('Initialized project Memory and Kanban directories.');
    } else if (command === 'task:new' && args.length === 2) {
        console.log(workflow.createTask(args[0] as string, args[1] as string));
    } else if (command === 'task:close' && args.length === 1) {
        console.log(workflow.closeTask(args[0] as string));
    } else if (command === 'check:kanban') {
        workflow.checkKanban();
        console.log('Kanban metadata is valid.');
    } else {
        throw new Error(
            'Usage: workflow.ts <init|task:new|task:close|check:kanban> ' +
            '[domain slug|id]',
        );
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
