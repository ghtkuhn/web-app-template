import fs from 'node:fs';
import path from 'node:path';
import {
    ScaffoldExecutionError,
    ScaffoldInputError,
} from '../scaffold-module/errors.ts';
import { ModuleName } from '../scaffold-module/module-name.ts';
import { TestCatalogManager } from '../test-catalog/test-catalog.manager.ts';
import type {
    TestScaffoldResult,
    TestScaffoldVerification,
} from './interfaces.ts';

/** Creates one baseline contract test for an existing backend module. */
export class TestScaffolder {
    private readonly backendRoot: string;
    private readonly verification: TestScaffoldVerification;

    /** Creates a test scaffolder rooted at one repository. */
    constructor(projectRoot: string, verification: TestScaffoldVerification) {
        this.backendRoot = path.join(path.resolve(projectRoot), 'code/backend');
        this.verification = verification;
    }

    /** Creates, catalogs, verifies, and transactionally rolls back one test. */
    public scaffold(rawModuleName: string): TestScaffoldResult {
        const moduleName = new ModuleName(rawModuleName);
        const moduleRoot = path.join(
            this.backendRoot,
            'src/module',
            moduleName.value,
        );
        this.requireModule(moduleName, moduleRoot);
        const testDirectory = path.join(moduleRoot, 'test');
        const testPath = path.join(
            testDirectory,
            `${moduleName.value}.module.test.ts`,
        );
        this.rejectCollision(testPath);
        const catalogPath = path.join(this.backendRoot, 'test.catalog.ts');
        const previousCatalog = fs.existsSync(catalogPath)
            ? fs.readFileSync(catalogPath, 'utf8')
            : null;
        const createdDirectory = !fs.existsSync(testDirectory);
        try {
            fs.mkdirSync(testDirectory, { recursive: true });
            fs.writeFileSync(testPath, this.render(moduleName), 'utf8');
            new TestCatalogManager(this.backendRoot).generate();
            this.verification.verify(this.backendRoot);
        } catch (error: unknown) {
            this.rollback(testPath, testDirectory, createdDirectory, catalogPath, previousCatalog);
            throw this.executionError(error);
        }
        return {
            moduleName: moduleName.value,
            file: this.relative(testPath),
        };
    }

    /** Requires a public module entry point. */
    private requireModule(moduleName: ModuleName, moduleRoot: string): void {
        if (!fs.existsSync(path.join(moduleRoot, 'index.ts'))) {
            throw new ScaffoldInputError(
                `Module '${moduleName.value}' does not exist or has no index.ts.`,
            );
        }
    }

    /** Refuses to overwrite an existing baseline test. */
    private rejectCollision(testPath: string): void {
        if (fs.existsSync(testPath)) {
            throw new ScaffoldInputError(
                `Target file '${this.relative(testPath)}' already exists.`,
            );
        }
    }

    /** Renders the executable public module contract test. */
    private render(moduleName: ModuleName): string {
        const constantName = `${moduleName.constantCase}_MODULE_NAME`;
        return `import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    ${constantName},
    ${moduleName.pascalCase}Module,
} from '../index.ts';

test('${moduleName.value} exposes its public module contract', () => {
    assert.equal(${constantName}, '${moduleName.value}');
    assert.equal(${moduleName.pascalCase}Module.definition.name, ${constantName});
    assert.ok(Array.isArray(${moduleName.pascalCase}Module.definition.dependencies));
});
`;
    }

    /** Restores only the test-scaffold transaction. */
    private rollback(
        testPath: string,
        testDirectory: string,
        createdDirectory: boolean,
        catalogPath: string,
        previousCatalog: string | null,
    ): void {
        fs.rmSync(testPath, { force: true });
        if (createdDirectory && fs.existsSync(testDirectory)) {
            fs.rmdirSync(testDirectory);
        }
        if (previousCatalog === null) {
            fs.rmSync(catalogPath, { force: true });
        } else {
            fs.writeFileSync(catalogPath, previousCatalog, 'utf8');
        }
    }

    /** Converts unexpected failures to stable execution errors. */
    private executionError(error: unknown): ScaffoldExecutionError {
        if (error instanceof ScaffoldExecutionError) {
            return error;
        }
        const message = error instanceof Error ? error.message : 'Unknown failure';
        return new ScaffoldExecutionError(`Unable to scaffold test: ${message}`);
    }

    /** Returns one normalized repository-relative path. */
    private relative(filePath: string): string {
        return path
            .relative(path.dirname(path.dirname(this.backendRoot)), filePath)
            .split(path.sep)
            .join('/');
    }
}
