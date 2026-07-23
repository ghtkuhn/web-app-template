import https from 'node:https';
import type { ProxmoxLxcTarget } from './interfaces.ts';

interface ProxmoxResponse<T> {
    readonly data: T;
}

/** Minimal token-authenticated Proxmox VE REST client. */
export class ProxmoxApiClient {
    private readonly tokenId: string;
    private readonly tokenSecret: string;
    private readonly target: ProxmoxLxcTarget;

    public constructor(
        target: ProxmoxLxcTarget,
        environment: NodeJS.ProcessEnv = process.env,
    ) {
        this.target = target;
        this.tokenId = environment.PROXMOX_API_TOKEN_ID ?? '';
        this.tokenSecret = environment.PROXMOX_API_TOKEN_SECRET ?? '';
        if (!this.tokenId || !this.tokenSecret) {
            throw new Error(
                'PROXMOX_API_TOKEN_ID and PROXMOX_API_TOKEN_SECRET are required.',
            );
        }
    }

    public async get<T>(path: string): Promise<T> {
        return await this.request<T>('GET', path);
    }

    public async post<T>(
        path: string,
        body: Record<string, string | number | boolean> = {},
    ): Promise<T> {
        return await this.request<T>('POST', path, body);
    }

    public async put<T>(
        path: string,
        body: Record<string, string | number | boolean> = {},
    ): Promise<T> {
        return await this.request<T>('PUT', path, body);
    }

    private request<T>(
        method: string,
        requestPath: string,
        body?: Record<string, string | number | boolean>,
    ): Promise<T> {
        const url = new URL(
            `/api2/json${requestPath}`,
            this.target.apiUrl,
        );
        const payload = body
            ? new URLSearchParams(
                Object.entries(body).map(([key, value]) => [
                    key,
                    String(value),
                ]),
            ).toString()
            : '';
        return new Promise<T>((resolve, reject) => {
            const request = https.request(url, {
                method,
                rejectUnauthorized: !this.target.allowInsecureTls,
                headers: {
                    authorization:
                        `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`,
                    'content-type': 'application/x-www-form-urlencoded',
                    'content-length': Buffer.byteLength(payload),
                },
            }, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if ((response.statusCode ?? 500) >= 400) {
                        let details = '';
                        try {
                            const parsed = JSON.parse(text) as {
                                data?: unknown;
                                errors?: Record<string, string>;
                            };
                            if (parsed.errors) {
                                details = ` ${JSON.stringify(parsed.errors)}`;
                            } else if (typeof parsed.data === 'string') {
                                details = ` ${parsed.data}`;
                            }
                        } catch {
                            // Ignore non-JSON error bodies to avoid logging secrets.
                        }
                        reject(new Error(
                            `Proxmox API ${method} ${requestPath} failed with status ${response.statusCode}.${details}`,
                        ));
                        return;
                    }
                    resolve((JSON.parse(text) as ProxmoxResponse<T>).data);
                });
            });
            request.on('error', reject);
            request.end(payload);
        });
    }
}
