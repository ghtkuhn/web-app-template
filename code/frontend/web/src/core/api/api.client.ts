import type { ApiError, ApiRequest, ApiResult } from './interfaces.ts';

type FetchImplementation = typeof fetch;

/** Owns HTTP transport and normalizes every failure into an ApiResult. */
export class ApiClient {
    private readonly baseUrl: URL;
    private readonly fetchImplementation: FetchImplementation;

    public constructor(
        baseUrl: string,
        fetchImplementation: FetchImplementation =
            globalThis.fetch.bind(globalThis),
        origin: string = window.location.origin,
    ) {
        this.baseUrl = new URL(baseUrl, origin);
        if (!this.baseUrl.pathname.endsWith('/')) {
            this.baseUrl.pathname += '/';
        }
        this.fetchImplementation = fetchImplementation;
    }

    /** Sends one JSON request and returns a discriminated result. */
    public async request<T>(
        requestPath: string,
        request: ApiRequest = {},
    ): Promise<ApiResult<T>> {
        try {
            const response = await this.fetchImplementation(
                new URL(requestPath.replace(/^\/+/, ''), this.baseUrl),
                {
                    method: request.method ?? 'GET',
                    body: request.body === undefined
                        ? undefined
                        : JSON.stringify(request.body),
                    headers: request.body === undefined
                        ? undefined
                        : { 'content-type': 'application/json' },
                    signal: request.signal,
                },
            );
            if (!response.ok) {
                return {
                    success: false,
                    error: {
                        type: 'http',
                        status: response.status,
                        message: `HTTP request failed with status ${response.status}.`,
                    },
                };
            }
            return await this.parse<T>(response);
        } catch (error) {
            return {
                success: false,
                error: this.transportError(error),
            };
        }
    }

    private async parse<T>(response: Response): Promise<ApiResult<T>> {
        try {
            return {
                success: true,
                data: await response.json() as T,
            };
        } catch {
            return {
                success: false,
                error: {
                    type: 'parse',
                    message: 'The backend returned invalid JSON.',
                },
            };
        }
    }

    private transportError(error: unknown): ApiError {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return {
                type: 'abort',
                message: 'The request was aborted.',
            };
        }
        return {
            type: 'network',
            message: error instanceof Error
                ? error.message
                : 'The network request failed.',
        };
    }
}
