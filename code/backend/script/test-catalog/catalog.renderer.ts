/** Renders the deterministic TypeScript backend test catalog. */
export class TestCatalogRenderer {
    /** Returns the complete generated catalog source. */
    public render(testFiles: readonly string[]): string {
        const entries = [...testFiles]
            .sort((left, right) => left.localeCompare(right))
            .map((file) => `    '${file}',`)
            .join('\n');
        return `/**
 * Generated backend test files executed by the central test runner.
 * Run \`npm run generate:test-catalog\` after adding or removing tests.
 */
export const BACKEND_TEST_FILES = [
${entries}
] as const;
`;
    }
}
