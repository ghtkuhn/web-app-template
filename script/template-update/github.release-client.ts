import type { TemplateRelease } from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';

type FetchImplementation = typeof fetch;
const MAXIMUM_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Resolves stable template releases through GitHub's public API. */
export class GitHubReleaseClient {
    private readonly repository: string;
    private readonly fetchImplementation: FetchImplementation;
    private readonly environment: NodeJS.ProcessEnv;

    public constructor(
        repository: string,
        fetchImplementation = fetch,
        environment = process.env,
    ) {
        this.repository = repository;
        this.fetchImplementation = fetchImplementation;
        this.environment = environment;
    }

    /** Resolves either the latest stable release or an explicit version. */
    public async resolve(version?: string): Promise<TemplateRelease> {
        const requested = version
            ? new SemanticVersion(version).value
            : undefined;
        const endpoint = requested
            ? `releases/tags/v${requested}`
            : 'releases/latest';
        const response = await this.fetchImplementation(
            `https://api.github.com/repos/${this.repository}/${endpoint}`,
            { headers: this.headers() },
        );
        if (!response.ok) {
            throw new Error(
                `GitHub release request failed with status ${response.status}.`,
            );
        }
        const release = await response.json() as {
            tag_name?: string;
            draft?: boolean;
            prerelease?: boolean;
        };
        if (
            !release.tag_name ||
            release.draft ||
            release.prerelease
        ) {
            throw new Error('GitHub did not return a stable release.');
        }
        const stable = new SemanticVersion(release.tag_name).value;
        if (requested && stable !== requested) {
            throw new Error(`GitHub returned unexpected release '${stable}'.`);
        }
        return {
            version: stable,
            tag: `v${stable}`,
            archiveUrl:
                `https://github.com/${this.repository}/archive/refs/tags/v${stable}.tar.gz`,
        };
    }

    /** Downloads one release archive to memory. */
    public async download(release: TemplateRelease): Promise<Buffer> {
        const response = await this.fetchImplementation(
            release.archiveUrl,
            { headers: this.headers() },
        );
        if (!response.ok) {
            throw new Error(
                `GitHub archive download failed with status ${response.status}.`,
            );
        }
        const declaredSize = Number(response.headers.get('content-length'));
        if (
            Number.isFinite(declaredSize) &&
            declaredSize > MAXIMUM_ARCHIVE_BYTES
        ) {
            throw new Error('GitHub release archive exceeds 100 MiB.');
        }
        const archive = Buffer.from(await response.arrayBuffer());
        if (archive.length > MAXIMUM_ARCHIVE_BYTES) {
            throw new Error('GitHub release archive exceeds 100 MiB.');
        }
        return archive;
    }

    private headers(): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'web-app-template-updater',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (this.environment.GITHUB_TOKEN) {
            headers.Authorization = `Bearer ${this.environment.GITHUB_TOKEN}`;
        }
        return headers;
    }
}
