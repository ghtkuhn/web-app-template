import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type FallowReport = {
    kind?: string;
    version?: string;
    verdict?: string;
    summary?: {
        dead_code_issues?: number;
        complexity_findings?: number;
        duplication_clone_groups?: number;
    };
    dead_code?: Record<string, unknown>;
    complexity?: {
        findings?: Array<{
            path?: string;
            name?: string;
            severity?: string;
        }>;
    };
    duplication?: {
        clone_groups?: Array<{
            instances?: Array<{ file?: string; start_line?: number }>;
        }>;
    };
    attribution?: {
        dead_code_introduced?: number;
        complexity_introduced?: number;
        duplication_introduced?: number;
        styling_introduced?: number;
    };
};

interface FallowProcessResult {
    readonly error?: Error;
    readonly status: number | null;
    readonly stdout?: string;
    readonly stderr?: string;
}

/** Runs Fallow while keeping console output bounded for agents and CI logs. */
export class FallowAudit {
    private static readonly VERSION = '3.15.0';
    private static readonly MAX_EXAMPLES = 10;
    private static readonly MAX_STDERR_CHARACTERS = 2_000;
    private readonly reportPath: string;
    private readonly projectRoot: string;
    private readonly execute: (
        command: string,
        arguments_: readonly string[],
    ) => FallowProcessResult;

    /** Creates an audit writing its complete report below ignored local state. */
    constructor(
        projectRoot = process.cwd(),
        execute = FallowAudit.execute,
    ) {
        this.projectRoot = projectRoot;
        this.reportPath = path.join(projectRoot, '.fallow/audit.json');
        this.execute = execute;
    }

    /**
     * Executes Fallow and rejects findings attributed to the current change.
     *
     * Fallow exits with code 1 when it reports findings. Inherited findings are
     * report-only; introduced findings fail with 1 and execution errors with 2.
     */
    public run(): number {
        if (!this.installedVersionIsExact()) {
            console.error(
                `Fallow ${FallowAudit.VERSION} must be installed locally.`,
            );
            return 2;
        }
        const executable = path.join(
            this.projectRoot,
            'node_modules/.bin',
            process.platform === 'win32' ? 'fallow.cmd' : 'fallow',
        );
        const result = this.execute(
            executable,
            ['audit', '--format', 'json'],
        );

        if (result.error) {
            console.error(`Unable to run Fallow: ${result.error.message}`);
            return 2;
        }

        const stdout = result.stdout ?? '';
        this.writeReport(stdout);
        this.writeBoundedStderr(result.stderr ?? '');
        let report: FallowReport;
        try {
            report = JSON.parse(stdout) as FallowReport;
        } catch (error: unknown) {
            console.error(
                `Fallow returned invalid JSON. Full output: ${this.relativeReportPath()}`,
            );
            return 2;
        }

        if (
            report.kind !== 'audit' ||
            report.version !== FallowAudit.VERSION ||
            !report.attribution
        ) {
            console.error(
                `Fallow returned an unsupported report. Full output: ${this.relativeReportPath()}`,
            );
            return 2;
        }
        this.writeSummary(report);
        if (result.status !== 0 && result.status !== 1) {
            return 2;
        }
        return this.introducedFindingCount(report) === 0 ? 0 : 1;
    }

    /** Persists the complete machine-readable result outside console output. */
    private writeReport(report: string): void {
        fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
        fs.writeFileSync(this.reportPath, report, 'utf8');
    }

    /** Prints only a bounded external-tool diagnostic. */
    private writeBoundedStderr(stderr: string): void {
        const trimmed = stderr.trim();
        if (!trimmed) {
            return;
        }
        const bounded = trimmed.slice(
            0,
            FallowAudit.MAX_STDERR_CHARACTERS,
        );
        console.error(
            `${bounded}${trimmed.length > bounded.length ? '\n… Fallow stderr truncated.' : ''}`,
        );
    }

    /** Prints aggregate counts and a small deterministic sample of findings. */
    // fallow-ignore-next-line complexity -- Formats independent optional report sections defensively.
    private writeSummary(report: FallowReport): void {
        const summary = report.summary ?? {};
        console.log(
            `Fallow audit: ${report.verdict ?? 'unknown'} — ` +
                `${summary.dead_code_issues ?? 0} dead-code, ` +
                `${summary.complexity_findings ?? 0} complexity, ` +
                `${summary.duplication_clone_groups ?? 0} duplication findings.`,
        );
        const examples = this.examples(report).slice(
            0,
            FallowAudit.MAX_EXAMPLES,
        );
        for (const example of examples) {
            console.log(`- ${example}`);
        }
        const findingCount =
            (summary.dead_code_issues ?? 0) +
            (summary.complexity_findings ?? 0) +
            (summary.duplication_clone_groups ?? 0);
        if (findingCount > examples.length) {
            console.log(
                `… ${findingCount - examples.length} additional findings omitted from console output.`,
            );
        }
        console.log(`Full Fallow report: ${this.relativeReportPath()}`);
    }

    private introducedFindingCount(report: FallowReport): number {
        const attribution = report.attribution ?? {};
        const count =
            (attribution.dead_code_introduced ?? 0) +
            (attribution.complexity_introduced ?? 0) +
            (attribution.duplication_introduced ?? 0) +
            (attribution.styling_introduced ?? 0);
        if (count > 0) {
            console.error(`Fallow found ${count} introduced finding(s).`);
        }
        return count;
    }

    private installedVersionIsExact(): boolean {
        try {
            const manifest = JSON.parse(fs.readFileSync(
                path.join(this.projectRoot, 'node_modules/fallow/package.json'),
                'utf8',
            )) as { version?: string };
            return manifest.version === FallowAudit.VERSION;
        } catch {
            return false;
        }
    }

    /** Selects compact examples without serializing complete finding payloads. */
    // fallow-ignore-next-line complexity -- Flattens two optional report collections.
    private examples(report: FallowReport): string[] {
        const examples: string[] = [];
        for (const finding of report.complexity?.findings ?? []) {
            examples.push(
                `complexity ${finding.severity ?? 'unknown'}: ` +
                    `${finding.path ?? 'unknown'}:${finding.name ?? 'anonymous'}`,
            );
        }
        for (const group of report.duplication?.clone_groups ?? []) {
            const instance = group.instances?.[0];
            if (instance?.file) {
                examples.push(
                    `duplication: ${instance.file}:${instance.start_line ?? 0}`,
                );
            }
        }
        return examples;
    }

    /** Returns a portable project-relative report path. */
    private relativeReportPath(): string {
        return path
            .relative(process.cwd(), this.reportPath)
            .split(path.sep)
            .join('/');
    }

    private static execute(
        command: string,
        arguments_: readonly string[],
    ): FallowProcessResult {
        return spawnSync(command, [...arguments_], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    process.exitCode = new FallowAudit().run();
}
