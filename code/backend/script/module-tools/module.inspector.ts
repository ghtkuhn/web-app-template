import fs from 'node:fs';
import path from 'node:path';
import { BackendLinter } from '../linter/backend.linter.ts';
import { ModuleName } from '../scaffold-module/module-name.ts';
import { DiagnosticRenderer } from '../../../../script/lint-diagnostics/diagnostic.renderer.ts';

/** Compact deterministic status for one backend module. */
export interface ModuleStatus {
    readonly moduleName: string;
    readonly state: 'contract' | 'blocked' | 'ready';
    readonly message: string;
}

/** Inspects one module without mutating its source. */
export class ModuleInspector {
    private readonly projectRoot: string;
    private readonly renderer: DiagnosticRenderer;

    /** Creates an inspector for one repository root. */
    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.renderer = new DiagnosticRenderer(this.projectRoot);
    }

    /** Returns the first actionable module status. */
    public inspect(rawModuleName: string): ModuleStatus {
        const moduleName = new ModuleName(rawModuleName);
        const moduleRoot = path.join(
            this.projectRoot,
            'code/backend/src/module',
            moduleName.value,
        );
        if (!fs.existsSync(path.join(moduleRoot, 'index.ts'))) {
            throw new Error(`Module '${moduleName.value}' does not exist.`);
        }
        const issue = new BackendLinter({ projectRoot: this.projectRoot })
            .run()
            .issues.find((candidate) =>
                candidate.file.startsWith(
                    `code/backend/src/module/${moduleName.value}/`,
                ),
            );
        if (issue) {
            return {
                moduleName: moduleName.value,
                state: 'blocked',
                message: this.renderer.render(issue).trimEnd(),
            };
        }
        if (!this.isExecutable(moduleRoot)) {
            return {
                moduleName: moduleName.value,
                state: 'contract',
                message:
                    'Contract module is valid. Next: scaffold a resource or architecture file.',
            };
        }
        return {
            moduleName: moduleName.value,
            state: 'ready',
            message: 'Module architecture is ready for focused verification.',
        };
    }

    /** Detects concrete executable architecture files conservatively. */
    private isExecutable(moduleRoot: string): boolean {
        return ['api', 'controller', 'service', 'store'].some((layer) => {
            const directory = path.join(moduleRoot, layer);
            return fs.existsSync(directory) &&
                fs.readdirSync(directory).some((file) => file.endsWith('.ts'));
        });
    }
}
