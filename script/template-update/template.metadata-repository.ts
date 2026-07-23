import fs from 'node:fs';
import path from 'node:path';
import type { TemplateMetadata } from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';

const DEFAULT_REPOSITORY = 'ghtkuhn/web-app-template';

/** Loads and renders the installed template version metadata. */
export class TemplateMetadataRepository {
    /** Loads metadata or initializes it from the root package version. */
    public load(projectRoot: string): TemplateMetadata {
        const metadataPath = path.join(
            projectRoot,
            '.template/version.json',
        );
        const source = (fs.existsSync(metadataPath)
            ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
            : JSON.parse(
                  fs.readFileSync(
                      path.join(projectRoot, 'package.json'),
                      'utf8',
                  ),
              )) as {
                  version?: string;
                  repository?: string;
              };
        if (!source.version) {
            throw new Error('Installed template version is missing.');
        }
        const version = new SemanticVersion(source.version).value;
        const repository = source.repository ?? DEFAULT_REPOSITORY;
        if (repository !== DEFAULT_REPOSITORY) {
            throw new Error(`Unsupported template repository '${repository}'.`);
        }
        return { version, repository };
    }

    /** Writes target metadata into a supplied staging path. */
    public render(targetPath: string, metadata: TemplateMetadata): void {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(
            targetPath,
            `${JSON.stringify(metadata, null, 4)}\n`,
        );
    }
}
