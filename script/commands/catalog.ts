import { FileTypeCatalog } from '../../code/backend/script/scaffold-module/file-type.catalog.ts';

/** Public command metadata shared by navigation and dispatch. No project I/O. */
export interface CommandDefinition {
    readonly syntax: string;
    readonly description: string;
    readonly example: string;
    readonly effects: string;
}

function command(syntax: string, description: string, example: string, effects: string): CommandDefinition {
    return { syntax, description, example, effects };
}

export const SCAFFOLDS = {
    file: { entry: 'code/backend/script/scaffold-file.ts', ...command('<module> <type> <name> [--owner <owner>]', `Create one backend architecture file. Types: ${new FileTypeCatalog().types().join(', ')}. --owner is required for auxiliary types and forbidden otherwise.`, 'billing dto invoice', 'Writes files; runs backend lint and typecheck.') },
    module: { entry: 'code/backend/script/scaffold-module.ts', ...command('<module>', 'Create and register a backend module.', 'billing', 'Writes module and registry files; runs backend lint and typecheck.') },
    operation: { entry: 'code/backend/script/scaffold-operation.ts', ...command('<module> <service> <operation> --input <type|void> --output <type|void>', 'Create an operation draft; service and named module-local input/output contracts must already exist.', 'billing invoices create-invoice --input CreateInvoiceInput --output InvoiceDTO', 'Writes an operation draft; runs backend checks. Implement execute(), then run npm run module:sync -- <module>.') },
    test: { entry: 'code/backend/script/scaffold-test.ts', ...command('<module>', 'Create an optional baseline module test, not business-risk coverage.', 'billing', 'Writes test and catalog; runs backend lint, typecheck, and only the created test.') },
    route: { entry: 'code/frontend/web/script/scaffold.ts', argument: 'route', ...command('<name>', 'Create a route and its three presentation views.', 'invoices', 'Writes frontend files and router; runs frontend lint and typecheck.') },
    component: { entry: 'code/frontend/web/script/scaffold.ts', argument: 'component', ...command('<desktop|tablet|mobile> <name>', 'Create a presentation-local component.', 'mobile invoice-card', 'Writes frontend files; runs frontend lint and typecheck.') },
    feature: { entry: 'code/frontend/web/script/scaffold.ts', argument: 'feature', ...command('<name>', 'Create a frontend Core feature.', 'invoices', 'Writes frontend files; runs frontend lint and typecheck.') },
    pwa: { entry: 'code/frontend/web/script/pwa-scaffold.ts', ...command('<app-id> --name "<Name>" --short-name "<Short Name>"', 'Install the optional PWA scaffold once.', 'billing --name "Billing App" --short-name "Billing"', 'Writes PWA files and dependencies; may install packages and run verification.') },
} as const;

const target = '<profile> <backend|frontend|all>';
export const DEPLOYMENTS = {
    validate: command('<profile> | --all', 'Validate deployment profiles without deploying.', '--all', 'Reads local configuration only.'),
    scaffold: command('<profile> [--from <profile>] [--backend-driver <driver>] [--frontend-driver <driver>] [--database <sqlite|postgres>]', 'Create a deployment profile. Drivers: docker, existing-lxc, proxmox-lxc.', 'production --from local', 'Writes a new profile; never overwrites an existing one.'),
    build: command(target, 'Build selected release artifacts or images.', 'local backend', 'Writes artifacts/images; may download dependencies.'),
    deploy: command(target, 'Deploy selected components using their profile drivers.', 'production backend', 'Mutates target services. Proxmox may provision its configured container; Existing-LXC never bootstraps or upgrades infrastructure.'),
    status: command(target, 'Inspect selected deployment status.', 'production backend', 'May contact Docker, SSH, or Proxmox.'),
    stop: command(target, 'Stop selected services.', 'production backend', 'Stops remote or local deployment services.'),
    diagnose: command(target, 'Collect deployment diagnostics.', 'production backend', 'Contacts target services; reports sanitized diagnostics.'),
    bootstrap: command(target, 'Explicitly bootstrap selected Existing-LXC infrastructure.', 'production backend', 'Changes the target operating system; requires SSH and possibly sudo credentials.'),
    'infrastructure:status': command(target, 'Inspect the infrastructure contract.', 'production backend', 'Contacts deployment targets.'),
    'infrastructure:upgrade': command(target, 'Explicitly upgrade infrastructure.', 'production backend', 'Changes target infrastructure; may require sudo credentials.'),
    rollback: command('<profile> <backend|frontend> [release-id]', 'Activate an existing LXC release; omitted ID selects previous.', 'production backend', 'Changes the active service release; never restores a database.'),
    'database:list': command('<profile>', 'List backend SQLite backups.', 'production', 'Contacts the backend; Proxmox may start its configured container. PostgreSQL is externally managed.'),
    'database:restore': command('<profile> <backup-id>', 'Restore one explicitly selected backend SQLite backup; latest is forbidden.', 'production backup-20260911', 'Replaces persistent database contents; Proxmox may start its configured container.'),
} as const;

export const COMMANDS = {
    'code:inspect': command('<file-path>', 'Inspect file dependencies, consumers, and evidence as JSON.', 'code/backend/src/base/base.store.ts', 'Reads source; updates local Fallow cache.'),
    'code:trace': command('<file-path>:<export>', 'Trace a best-effort caller/callee chain, limited to two hops.', 'code/backend/src/base/base.store.ts:BaseStore', 'Reads source; updates local Fallow cache. Missing edges do not prove no impact.'),
    scaffold: command('<type> [args]', 'Create architecture-aligned files; use help scaffold <type> for parameters.', 'module billing', 'Writes files and runs scaffold-specific checks.'),
    lint: command('', 'Check workspace architecture, styles, and OpenAPI.', '', 'Read-only checks.'),
    typecheck: command('', 'Typecheck root tooling and both workspaces.', '', 'Read-only checks.'),
    test: command('[--module <module> | --file <file-path>]', 'Run all workspace tests, direct backend module tests, or exactly one test file.', '--module health', 'Executes tests and their fixtures; integration tests may require Docker. Browser/PWA tests are separate.'),
    verify: command('', 'Run the complete required quality pipeline once at completion.', '', 'Runs checks, tests, builds, and browsers; requires their services. Reuse valid results.'),
    help: command('[topic] [command]', 'Show focused, offline command help.', 'scaffold operation', 'No configuration, credentials, checks, or external services are accessed.'),
    deployment: command('<action> [args]', 'Operate explicitly selected deployment targets.', 'status production backend', 'Action-dependent; see help deployment <action>.'),
    'runtime:check': command('', 'Check the pinned Node/npm contract.', '', 'Read-only check.'),
    'credentials:init': command('', 'Create the local credential file without overwriting.', '', 'Creates .credentials.env with mode 0600.'),
    'credentials:check': command('', 'Check credential metadata, ignores, and Git safeguards.', '', 'Does not read secret contents.'),
    'credentials:run': command('<npm-script> [args]', 'Load credentials only into a child process.', 'deployment deploy production backend', 'Runs the selected script with secrets in its environment; redacts output.'),
    'workflow:init': command('', 'Initialize missing local workflow state.', '', 'Creates missing Memory and Kanban state.'),
    'task:new': command('<domain> <slug>', 'Reserve an ID and create a task draft.', 'backend invoice-validation', 'Writes counter and task file.'),
    'task:close': command('<id>', 'Validate evidence and close a task.', '12', 'Moves a validated task to done.'),
    'check:kanban': command('', 'Validate Kanban tasks and evidence.', '', 'Read-only check.'),
    'check:memory': command('', 'Check Memory size.', '', 'Read-only check.'),
    'lint:backend': command('', 'Check backend architecture and OpenAPI.', '', 'Read-only checks.'),
    'module:status': command('<module>', 'Inspect backend module structure.', 'health', 'Read-only check.'),
    'module:sync': command('<module>', 'Regenerate one module’s mechanics.', 'health', 'Writes generated module files.'),
    'module:dependency': command('<consumer> <provider>', 'Declare a module dependency and synchronize.', 'billing auth', 'Writes module manifest and mechanics.'),
    'check:modules': command('', 'Check generated module mechanics for drift.', '', 'Read-only check.'),
    'generate:api': command('', 'Regenerate backend OpenAPI and frontend types.', '', 'Writes generated contracts; uses a temporary auth database.'),
    'check:api': command('', 'Check OpenAPI and frontend API types for drift.', '', 'Checks generated contracts using temporary state.'),
    'generate:migrations': command('', 'Regenerate the migration checksum catalog.', '', 'Writes the catalog; review migrations first.'),
    'check:migrations': command('', 'Check migration order, dialect pairs, and checksums.', '', 'Read-only check.'),
    'generate:test-catalog': command('', 'Regenerate backend test discovery.', '', 'Writes the backend test catalog.'),
    'check:test-catalog': command('', 'Check backend test catalog drift.', '', 'Read-only check.'),
    icons: command('<search-term> | --all', 'Search the local Tabler icon catalog or list all icons.', 'arrow', 'Reads the local catalog.'),
    'store:migration-status': command('[--json]', 'Find legacy generic Store methods without renaming.', '--json', 'Read-only inspection.'),
    'template:check': command('', 'Check stable upstream template releases.', '', 'Reads GitHub release metadata; requires network.'),
    'template:init': command('<installed-version>', 'Initialize legacy template metadata once.', '5.0.13', 'Downloads release metadata and writes local template metadata.'),
    'template:update': command('[version] | --continue <version> | --abort <version>', 'Update the template or resolve/abort staged conflicts.', '', 'Downloads releases, merges files, installs dependencies, and verifies. Does not commit or deploy.'),
    'generate:lxc-contract': command('', 'Regenerate LXC contract checksums after cross-file review.', '', 'Writes infrastructure checksum catalogs, not remote infrastructure.'),
    'check:lxc-contract': command('', 'Check the LXC cross-file contract.', '', 'Read-only check.'),
    build: command('', 'Build workspaces with build scripts.', '', 'Writes build artifacts.'),
    audit: command('', 'Check code health with pinned local Fallow.', '', 'Writes local reports/cache; no package security audit.'),
    'verify:module': command('<module>', 'Run backend-wide type/lint checks and direct module tests.', 'health', 'Runs checks and module tests; not a full repository Verify.'),
} as const;

export const DAILY_COMMANDS = ['code:inspect', 'code:trace', 'scaffold', 'lint', 'typecheck', 'test', 'verify', 'help'] as const;

export function definition<T>(definitions: Readonly<Record<string, T>>, key: string): T | undefined {
    return Object.hasOwn(definitions, key) ? definitions[key] : undefined;
}

function render(name: string, value: CommandDefinition, subcommand = ''): string {
    const syntax = [subcommand, value.syntax].filter(Boolean).join(' ');
    const example = [subcommand, value.example].filter(Boolean).join(' ');
    return `npm run ${name}${syntax ? ` -- ${syntax}` : ''}\n${value.description}\nExample: npm run ${name}${example ? ` -- ${example}` : ''}\nEffects: ${value.effects}\n`;
}

/** Produces local help without running any command or loading application state. */
export function commandHelp(args: readonly string[]): string {
    if (args.length === 0) {
        return DAILY_COMMANDS.map((name) => render(name, COMMANDS[name])).join('\n') +
            '\nTopics: scaffold, deployment, credentials, workflow, template, maintenance.\nUse npm run help -- <topic> [command]. Paths are repository-relative; quote spaces.\n';
    }
    const [topic, child] = args;
    if (args.length > 2) throw new Error('Usage: npm run help -- [topic] [command]');
    if (topic === 'scaffold' || topic === 'deployment') {
        const entries: Readonly<Record<string, CommandDefinition>> = topic === 'scaffold' ? SCAFFOLDS : DEPLOYMENTS;
        if (child) {
            const value = definition(entries, child);
            if (!value) throw new Error(`Unknown ${topic} command '${child}'. Use npm run help -- ${topic}.`);
            return render(topic, value, child);
        }
        return Object.entries(entries).map(([name, value]) =>
            render(topic, value, name)).join('\n');
    }
    if (child) throw new Error(`Use npm run help -- ${topic} without an additional command.`);
    const groups: Record<string, readonly string[]> = {
        credentials: ['credentials:init', 'credentials:check', 'credentials:run'],
        workflow: ['workflow:init', 'task:new', 'task:close', 'check:kanban', 'check:memory'],
        template: ['template:check', 'template:init', 'template:update'],
        maintenance: Object.keys(COMMANDS).filter((name) => !DAILY_COMMANDS.some((daily) => daily === name) &&
            !/^(credentials:|workflow:|task:|template:|deployment$)/u.test(name)),
    };
    const group = definition(groups, topic);
    if (group) return group.map((name) => render(name, definition(COMMANDS, name)!)).join('\n');
    const value = definition(COMMANDS, topic);
    if (!value) throw new Error(`Unknown help topic '${topic}'. Use npm run help.`);
    return render(topic, value);
}
