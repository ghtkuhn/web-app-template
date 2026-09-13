import type { TemplateRelease } from './interfaces.ts';
import { SemanticVersion } from './semantic-version.ts';
import { DEFAULT_TEMPLATE_REPOSITORY } from './template.metadata-repository.ts';

const API_ROOT = 'https://git.tobitron.com/api/v1/repos/tobias/web-app-template';
const MAXIMUM_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Reads stable releases exclusively from the private template repository. */
export class PrivateReleaseClient {
    private readonly fetchImplementation: typeof fetch;
    private readonly environment: NodeJS.ProcessEnv;

    public constructor(
        repository: string,
        fetchImplementation = fetch,
        environment = process.env,
    ) {
        if (repository !== DEFAULT_TEMPLATE_REPOSITORY) {
            throw new Error('Unsupported private template repository.');
        }
        this.fetchImplementation = fetchImplementation;
        this.environment = environment;
    }

    /** Resolves the latest stable release or one exact version. */
    public async resolve(version?: string): Promise<TemplateRelease> {
        const requested = version ? new SemanticVersion(version).value : undefined;
        const endpoint = requested ? `releases/tags/v${requested}` : 'releases/latest';
        const response = await this.request(`${API_ROOT}/${endpoint}`);
        let release: unknown;
        try {
            release = await response.json();
        } catch {
            throw new Error('Private template release response is not valid JSON.');
        }
        if (!release || typeof release !== 'object' ||
            !('tag_name' in release) || typeof release.tag_name !== 'string' ||
            !('draft' in release) || release.draft !== false ||
            !('prerelease' in release) || release.prerelease !== false) {
            throw new Error('Private repository did not return a stable release.');
        }
        let stable: string;
        try {
            stable = new SemanticVersion(release.tag_name).value;
        } catch {
            throw new Error('Private repository returned an invalid stable release tag.');
        }
        if (release.tag_name !== `v${stable}` || (requested && stable !== requested)) {
            throw new Error('Private repository returned an unexpected release tag.');
        }
        return { version: stable, tag: `v${stable}`, archiveUrl: this.archiveUrl(stable) };
    }

    /** Downloads only the canonical same-origin archive, with a bounded body. */
    public async download(release: TemplateRelease): Promise<Buffer> {
        const version = new SemanticVersion(release.version).value;
        if (release.tag !== `v${version}` || release.archiveUrl !== this.archiveUrl(version)) {
            throw new Error('Untrusted private template archive URL or tag.');
        }
        const response = await this.request(release.archiveUrl);
        if (Number(response.headers.get('content-length')) > MAXIMUM_ARCHIVE_BYTES) {
            await response.body?.cancel();
            throw new Error('Private template archive exceeds 100 MiB.');
        }
        if (!response.body) {
            throw new Error('Private template archive body is missing.');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > MAXIMUM_ARCHIVE_BYTES) {
                    await reader.cancel();
                    throw new Error('Archive size limit exceeded.');
                }
                chunks.push(chunk.value);
            }
        } catch {
            throw new Error('Private template archive download failed or exceeds 100 MiB.');
        } finally {
            reader.releaseLock();
        }
        return Buffer.concat(chunks, size);
    }

    private archiveUrl(version: string): string {
        return `${API_ROOT}/archive/v${version}.tar.gz`;
    }

    private async request(url: string): Promise<Response> {
        const token = this.environment.TEMPLATE_REPOSITORY_TOKEN;
        if (!token || token.trim() !== token || /\s/.test(token)) {
            throw new Error(
                'Set a valid TEMPLATE_REPOSITORY_TOKEN with repository read access in .credentials.env; ' +
                'run npm run credentials:run -- template:check (or template:update).',
            );
        }
        let response: Response;
        try {
            response = await this.fetchImplementation(url, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `token ${token}`,
                    'User-Agent': 'web-app-template-updater',
                },
                redirect: 'error',
                signal: AbortSignal.timeout(60_000),
            });
        } catch {
            throw new Error('Private template request failed: check HTTPS access, certificate, and server availability. Redirects are forbidden.');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(
                `Private template request failed with status ${response.status}. ` +
                'Check token access and that the release exists. Applications must first install the final GitHub bridge release 6.0.2; no GitHub fallback is used.',
            );
        }
        return response;
    }
}
