import fs from 'node:fs';
import path from 'node:path';
import type { TemplateMetadata } from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';

const DEFAULT_REPOSITORY = 'ghtkuhn/web-app-template';

/** npm package repository metadata accepted during legacy initialization. */
interface PackageRepository {
    readonly type?: string;
    readonly url?: string;
}

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
                  repository?: string | PackageRepository;
              };
        if (!source.version) {
            throw new Error('Installed template version is missing.');
        }
        const version = new SemanticVersion(source.version).value;
        const repository = this.normalizeRepository(source.repository);
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

    /** Normalizes the npm string or object repository representation. */
    private normalizeRepository(
        repository?: string | PackageRepository,
    ): string {
        if (!repository) {
            return DEFAULT_REPOSITORY;
        }

        const repositoryUrl =
            typeof repository === 'string' ? repository : repository.url;
        if (!repositoryUrl) {
            throw new Error('Template repository URL is missing.');
        }
        if (repositoryUrl === DEFAULT_REPOSITORY) {
            return repositoryUrl;
        }

        try {
            const parsed = new URL(repositoryUrl.replace(/^git\+/, ''));
            const repositoryPath = parsed.pathname
                .replace(/^\/|\/$/g, '')
                .replace(/\.git$/, '');
            return parsed.hostname === 'github.com'
                ? repositoryPath
                : repositoryUrl;
        } catch {
            return repositoryUrl;
        }
    }
}
