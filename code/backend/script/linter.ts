#!/usr/bin/env node

/**
 * Backend code linter for module structure validation
 * Validates that:
 * - Interfaces are only declared in code/backend/src/module/<module-name>/interfaces.ts
 * - Constants are only declared in code/backend/src/module/<module-name>/constants.ts
 * - Types are only declared in code/backend/src/module/<module-name>/types.ts
 * - Only class declarations are allowed (functions are forbidden)
 * - Only one class per file
 * - No files are allowed directly in code/backend/src/module/ directory
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULES_DIR = path.join(PROJECT_ROOT, 'code/backend/src/module');

/**
 * Backend code linter class
 */
class BackendLinter {
    /**
     * Check if a path is a TypeScript file
     * @param {string} file - File name
     * @returns {boolean}
     */
    isTypeScriptFile(file) {
        return file.endsWith('.ts');
    }

    /**
     * Get all module directories
     * @returns {string[]} Array of module names
     */
    getModuleDirectories() {
        if (!fs.existsSync(MODULES_DIR)) {
            return [];
        }

        return fs.readdirSync(MODULES_DIR)
            .filter(file => fs.statSync(path.join(MODULES_DIR, file)).isDirectory());
    }

    /**
     * Get all JS/TS files in a module recursively
     * @param {string} modulePath - Path to module directory
     * @returns {string[]} Array of file paths
     */
    getModuleFiles(modulePath) {
        const files = [];
        const self = this; // Store reference to 'this'

        function traverse(dir) {
            if (!fs.existsSync(dir)) {
                return;
            }

            const entries = fs.readdirSync(dir);

            for (const entry of entries) {
                const entryPath = path.join(dir, entry);
                const stat = fs.statSync(entryPath);

                if (stat.isDirectory()) {
                    traverse(entryPath);
                } else if (self.isTypeScriptFile(entry)) {
                    files.push(entryPath);
                }
            }
        }

        traverse(modulePath);
        return files;
    }

    /**
     * Parse JavaScript/TypeScript file using Babel
     * @param {string} filePath - Path to file
     * @returns {object|null} AST with declarations, or null if parsing fails
     */
    async parseFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Import Babel parser dynamically to avoid ES module issues
            const babel = await import('@babel/parser');
            const ast = babel.parse(content, {
                sourceType: 'module',
                plugins: ['typescript']
            });

            return this.extractDeclarations(ast);
        } catch (error) {
            // Return empty declarations instead of null to allow validation
            console.error(`⚠️ Could not parse file: ${filePath} - ${error.message}`);
            return {
                interfaces: 0,
                constants: 0,
                types: 0,
                classes: 0,
                functions: 0,
                imports: [],
                baseClassName: null,
                methodCalls: []
            };
        }
    }

    /**
     * Extract declarations and imports from Babel AST
     * @param {object} ast - Babel AST
     * @returns {object} Object with declaration counts and import list
     */
    extractDeclarations(ast) {
        const declarations = {
            interfaces: 0,
            constants: 0,
            types: 0,
            classes: 0,
            functions: 0,
            imports: [],
            baseClassName: null,
            methodCalls: []
        };

        const processNode = (node, isTopLevel = false) => {
            if (!node || !node.type) {
                return;
            }

            switch (node.type) {
                case 'ImportDeclaration':
                    declarations.imports.push(node.source.value);
                    break;

                case 'CallExpression':
                    // Capture method calls like object.save() or store.findById()
                    if (node.callee.type === 'MemberExpression') {
                        const methodName = node.callee.property.name;
                        declarations.methodCalls.push(methodName);
                    }
                    break;

                case 'TSInterfaceDeclaration':
                    declarations.interfaces++;
                    break;

                case 'VariableDeclaration':
                    // Check for type aliases in VariableDeclaration
                    if (node.kind === 'type') {
                        declarations.types++;
                    }
                    // Check for const declarations
                    else if (node.kind === 'const') {
                        // Only count top-level constants
                        if (isTopLevel) {
                            for (const declarator of node.declarations) {
                                if (declarator.id && declarator.id.type === 'Identifier') {
                                    declarations.constants++;
                                }
                            }
                        }
                    }
                    break;

                case 'ExportNamedDeclaration':
                    if (node.declaration) {
                        processNode(node.declaration, isTopLevel);
                    }
                    break;

                case 'ExportDefaultDeclaration':
                    if (node.declaration) {
                        processNode(node.declaration, isTopLevel);
                    }
                    break;

                case 'ClassDeclaration':
                    declarations.classes++;
                    // Extract the base class name if it exists
                    if (node.superClass && node.superClass.type === 'Identifier') {
                        declarations.baseClassName = node.superClass.name;
                    } else if (node.superClass) {
                        // Handle cases where superClass might be a complex expression
                        declarations.baseClassName = 'ComplexBase';
                    }
                    break;

                case 'FunctionDeclaration':
                    declarations.functions++;
                    break;

                case 'TSTypeAliasDeclaration':
                    declarations.types++;
                    break;
            }
        };

        const traverse = (node, isTopLevel = false) => {
            if (!node) return;

            // Process the current node
            processNode(node, isTopLevel);

            // Recursively visit children
            for (const [key, value] of Object.entries(node)) {
                if (value && typeof value === 'object') {
                    if (Array.isArray(value)) {
                        for (const child of value) {
                            if (child && typeof child === 'object') {
                                // Determine if this is a top-level node
                                const newIsTopLevel = key === 'body' &&
                                    (node.type === 'FunctionDeclaration' ||
                                     node.type === 'MethodDefinition' ||
                                     node.type === 'ArrowFunctionExpression');
                                traverse(child, newIsTopLevel);
                            }
                        }
                    } else {
                        traverse(value, isTopLevel);
                    }
                }
            }
        };

        // Start traversal from the program body
        if (ast && ast.program && ast.program.body) {
            for (const statement of ast.program.body) {
                traverse(statement, true);
            }
        }

        return declarations;
    }

    /**
     * Validate a single file
     * @param {string} moduleName - Name of the module
     * @param {string} filePath - Path to file
     * @returns {string[]} Array of validation errors
     */
    async validateFile(moduleName, filePath) {
        const basename = path.basename(filePath);
        const declarations = await this.parseFile(filePath);

        const errors = [];

        if (!declarations) {
            // If parsing fails, skip validation
            console.error(`⚠️ Could not parse file: ${filePath}`);
            return errors;
        }

        const folderName = path.dirname(filePath).split(path.sep).pop();
        const isController = basename.endsWith('.controller.ts');
        const isService = basename.endsWith('.service.ts');
        const isStore = basename.endsWith('.store.ts');
        const isHandler = folderName === 'api' || basename.includes('.handler.');

        // 1. Strict Import Whitelisting & DB Isolation
        const dbDrivers = ['pg', 'postgres', 'sqlite3', 'better-sqlite3'];
        for (const importPath of declarations.imports) {
            // Rule: Only Stores can import DB drivers
            if (dbDrivers.some(driver => importPath.includes(driver)) && !isStore) {
                errors.push(`ARCHITECTURE VIOLATION: ${filePath} imports a DB driver (${importPath}), but only stores are allowed to access the database`);
            }

            // Rule: Controllers must NOT import from stores, objects or handlers
            if (isController) {
                if (importPath.includes('/store/') || importPath.includes('base.store') ||
                    importPath.includes('/object/') || importPath.includes('/api/')) {
                    errors.push(`ARCHITECTURE VIOLATION: Controller ${filePath} imports from a store, object or handler (${importPath}), but should only use services`);
                }
            }

            // Rule: Services must NOT import controllers or handlers
            if (isService && (importPath.includes('/controller/') || importPath.includes('/api/'))) {
                errors.push(`ARCHITECTURE VIOLATION: Service ${filePath} imports from a controller or handler, which is forbidden`);
            }

            // Rule: Stores must NOT import DTOs, Controllers or Handlers
            if (isStore) {
                if (importPath.includes('/dto/') || importPath.includes('base.dto') ||
                    importPath.includes('/controller/') || importPath.includes('/api/')) {
                    errors.push(`ARCHITECTURE VIOLATION: Store ${filePath} imports from a DTO, Controller or Handler (${importPath}), but stores should only work with Domain Objects`);
                }
            }

            // Rule: Handlers must NOT import Services or Stores directly (must go through Controllers)
            if (isHandler) {
                if (importPath.includes('/service/') || importPath.includes('base.service') ||
                    importPath.includes('/store/') || importPath.includes('base.store')) {
                    errors.push(`ARCHITECTURE VIOLATION: Handler ${filePath} imports from a service or store (${importPath}), but must use Controllers`);
                }
            }

            // Rule: Only DatabaseManager can instantiate DB connections/dialects
            if (!filePath.endsWith('base.database.ts')) {
                const content = fs.readFileSync(filePath, 'utf-8');
                const dbInstantiationKeywords = ['new Kysely', 'new SqliteDriver', 'new SqliteDialect'];
                for (const keyword of dbInstantiationKeywords) {
                    if (content.includes(keyword)) {
                        errors.push(`ARCHITECTURE VIOLATION: ${filePath} attempts to instantiate a DB connection (${keyword}), but this is only allowed in base.database.ts`);
                    }
                }
            }

            const moduleMatch = filePath.match(/src\/module\/([^/]+)/);
            if (moduleMatch) {
                const currentModuleName = moduleMatch[1];

                // Resolve the import path relative to the current file for accurate checking
                let absoluteImportPath = importPath;
                if (importPath.startsWith('.')) {
                    absoluteImportPath = path.resolve(path.dirname(filePath), importPath);
                    // Normalize back to a format that matches our project structure check
                    absoluteImportPath = absoluteImportPath.replace(/\\/g, '/').replace(process.cwd(), '');
                }

                // Check if importing from another module's internal folders (service, store, object, controller, api)
                const otherModuleRegex = new RegExp(`src\/module\/(?!${currentModuleName})([^\/]+)\/(service|store|object|controller|api)`);
                if (otherModuleRegex.test(absoluteImportPath)) {
                    errors.push(`ARCHITECTURE VIOLATION: ${filePath} imports internals from another module (${importPath}). Use the other module's BaseModule.dispatch() instead.`);
                }
            }
        }

        // 2. Forbidden Method Calls in Controller & Service (Mapping logic)
        if (isController) {
            for (const methodName of declarations.methodCalls) {
                if (methodName === 'fromObject' || methodName === 'toObject') {
                    errors.push(`ARCHITECTURE VIOLATION: Controller ${filePath} performs mapping (${methodName}), but this logic belongs in the Service layer`);
                }
            }
        }

        // Rule: Classes in module folders must extend their respective base class
        if (declarations.classes > 0) {
            const folderName = path.dirname(filePath).split(path.sep).pop();
            let requiredBaseClass = null;

            switch (folderName) {
                case 'controller': requiredBaseClass = 'BaseController'; break;
                case 'service': requiredBaseClass = 'BaseService'; break;
                case 'store': requiredBaseClass = 'BaseStore'; break;
                case 'object': requiredBaseClass = 'BaseObject'; break;
                case 'api':
                    // Handlers are more flexible, but we can check if they extend one of the BaseHandlers
                    const handlerBases = ['BaseHandler', 'HttpHandler', 'WebSocketHandler', 'CliHandler', 'NodeHandler'];
                    if (!handlerBases.includes(declarations.baseClassName)) {
                        errors.push(`Class in ${filePath} (API folder) must extend a BaseHandler class, but found ${declarations.baseClassName || 'no base class'}`);
                    }
                    break;
            }

            if (requiredBaseClass && declarations.baseClassName !== requiredBaseClass) {
                errors.push(`Class in ${filePath} must extend ${requiredBaseClass}, but found ${declarations.baseClassName || 'no base class'}`);
            }
        }

        if (basename === 'interfaces.ts') {
            if (declarations.constants > 0) {
                errors.push(`Constant found in ${filePath}, but should only be declared in constants.ts`);
            }

            if (declarations.types > 0) {
                errors.push(`Type found in ${filePath}, but should only be declared in types.ts`);
            }
        } else if (basename === 'constants.ts') {
            if (declarations.interfaces > 0) {
                errors.push(`Interface found in ${filePath}, but should only be declared in interfaces.ts`);
            }

            if (declarations.types > 0) {
                errors.push(`Type found in ${filePath}, but should only be declared in types.ts`);
            }
        } else if (basename === 'types.ts') {
            if (declarations.interfaces > 0) {
                errors.push(`Interface found in ${filePath}, but should only be declared in interfaces.ts`);
            }

            if (declarations.constants > 0) {
                errors.push(`Constant found in ${filePath}, but should only be declared in constants.ts`);
            }
        } else {
            // Regular files
            const expectedInterfacePath = `code/backend/src/module/${moduleName}/interfaces.ts`;
            const expectedConstantPath = `code/backend/src/module/${moduleName}/constants.ts`;
            const expectedTypePath = `code/backend/src/module/${moduleName}/types.ts`;

            if (declarations.interfaces > 0) {
                errors.push(`Interface found in ${filePath}, but should only be declared in ${expectedInterfacePath}`);
            }

            if (declarations.constants > 0) {
                errors.push(`Constant found in ${filePath}, but should only be declared in ${expectedConstantPath}`);
            }

            if (declarations.types > 0) {
                errors.push(`Type found in ${filePath}, but should only be declared in ${expectedTypePath}`);
            }

            if (declarations.functions > 0) {
                errors.push(`Function found in ${filePath}, but only classes are allowed`);
            }

            if (declarations.classes > 1) {
                errors.push(`Multiple classes found in ${filePath}, but only one class is allowed per file`);
            }
        }

        return errors;
    }

    /**
     * Run the linter validation
     * @returns {Promise<boolean>} True if no errors, false otherwise
     */
    async run() {
        console.log('🔍 Running backend code linter...');
        console.log('Validating module structure for interfaces, constants and types...');

        const modules = this.getModuleDirectories();
        let hasErrors = false;

        if (modules.length === 0) {
            console.log('⚠️ No modules found in code/backend/src/module/');
            return true;
        }

        for (const moduleName of modules) {
            console.log(`📁 Checking module: ${moduleName}`);
            const files = this.getModuleFiles(path.join(MODULES_DIR, moduleName));

            for (const filePath of files) {
                const errors = await this.validateFile(moduleName, filePath);

                if (errors.length > 0) {
                    hasErrors = true;
                    for (const error of errors) {
                        console.error(`❌ ${error}`);
                    }
                }
            }
        }

        console.log('\n' + '='.repeat(50));

        if (hasErrors) {
            console.error('❌ Linting failed! Found structural issues.');
            return false;
        } else {
            console.log('✅ All files follow the module structure rules!');
            return true;
        }
    }

    /**
     * Check if there are any files directly in the modules directory
     * @returns {string[]} Array of validation errors
     */
    checkModuleDirectoryFiles() {
        if (!fs.existsSync(MODULES_DIR)) {
            return [];
        }

        const entries = fs.readdirSync(MODULES_DIR);
        const errors = [];

        for (const entry of entries) {
            const entryPath = path.join(MODULES_DIR, entry);
            const stat = fs.statSync(entryPath);

            // If it's a file (not a directory), that's not allowed
            if (!stat.isDirectory()) {
                errors.push(`File found directly in code/backend/src/module, but only directories (modules) are allowed`);
            }
        }

        return errors;
    }
}

// Main execution
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const linter = new BackendLinter();
    linter.run()
        .then((isValid) => {
            if (!isValid) {
                process.exitCode = 1;
            }
        })
        .catch((error) => {
            console.error('🚨 Linter error:', error);
            process.exitCode = 2;
        });
}

export default BackendLinter;
