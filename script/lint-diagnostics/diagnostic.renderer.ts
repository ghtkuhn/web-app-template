import fs from 'node:fs';
import path from 'node:path';
import type {
    DiagnosticLocation,
    LintIssue,
    SourceSpan,
} from './interfaces.ts';

/** Renders complete, deterministic architecture reviews for terminal readers. */
export class DiagnosticRenderer {
    private readonly projectRoot: string;

    public constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
    }

    /** Renders one issue without relying on external architecture documents. */
    public render(issue: LintIssue): string {
        const level = issue.severity === 'fatal' ? 'FATAL' : 'ERROR';
        const sections = [
            `${level} [${issue.ruleId}] ${issue.title}`,
            `Where: ${this.location(issue.file, issue.location)}`,
        ];
        const frame = this.codeFrame(issue.file, issue.location);
        if (frame) {
            sections.push('', frame);
        }
        for (const related of issue.relatedLocations) {
            sections.push(`Related: ${this.relatedLocation(related)}`);
        }
        sections.push(
            `Found: ${issue.observed}`,
            `Why: ${issue.why}`,
            `Meaning: ${issue.meaning}`,
            `Architecture: ${issue.context}`,
            'How to fix:',
            ...issue.fixSteps.map((step, index) => `  ${index + 1}. ${step}`),
            'Verify:',
            ...issue.verify.map((command) => `  ${command}`),
        );
        return `${sections.join('\n')}\n`;
    }

    private relatedLocation(related: DiagnosticLocation): string {
        return `${related.label} at ${this.location(
            related.file,
            related.location,
        )}`;
    }

    private location(file: string, span: SourceSpan | null): string {
        return span
            ? `${file}:${span.start.line}:${span.start.column}`
            : `${file} (file or project-level contract)`;
    }

    /** Renders the primary line with one surrounding line on either side. */
    private codeFrame(file: string, span: SourceSpan | null): string | null {
        if (!span) {
            return null;
        }
        const filePath = path.resolve(this.projectRoot, file);
        if (!this.isProjectFile(filePath)) {
            return null;
        }
        let source: string;
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                return null;
            }
            source = fs.readFileSync(filePath, 'utf8');
        } catch {
            return null;
        }
        const lines = source.split(/\r?\n/u);
        const targetIndex = span.start.line - 1;
        if (targetIndex < 0 || targetIndex >= lines.length) {
            return null;
        }
        const first = Math.max(0, targetIndex - 1);
        const last = Math.min(lines.length - 1, targetIndex + 1);
        const width = String(last + 1).length;
        const rendered: string[] = [];
        for (let index = first; index <= last; index += 1) {
            const rawLine = lines[index];
            const sourceLine = rawLine.replaceAll('\t', '    ');
            rendered.push(`${String(index + 1).padStart(width)} | ${sourceLine}`);
            if (index === targetIndex) {
                const rawStart = Math.max(0, span.start.column - 1);
                const start = rawLine
                    .slice(0, rawStart)
                    .replaceAll('\t', '    ')
                    .length;
                const requestedLength = span.end.line === span.start.line
                    ? rawLine
                          .slice(rawStart, span.end.column - 1)
                          .replaceAll('\t', '    ')
                          .length
                    : sourceLine.length - start;
                const length = Math.max(1, requestedLength);
                rendered.push(
                    `${' '.repeat(width)} | ${' '.repeat(start)}${'^'.repeat(length)}`,
                );
            }
        }
        return rendered.join('\n');
    }

    private isProjectFile(filePath: string): boolean {
        const relative = path.relative(this.projectRoot, filePath);
        return relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative);
    }
}
