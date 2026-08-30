import type {
    ApiRequest,
    ApiResult,
    AuthTokenReader,
} from './interfaces.ts';
import { toTransportApiError } from './api-error.ts';
import { authTokenStore } from './auth-token.store.ts';

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
        private readonly tokenReader: AuthTokenReader = authTokenStore,
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
                    headers: this.headers(request.body !== undefined),
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
                error: toTransportApiError(error),
            };
        }
    }

    /** Builds transport headers without exposing token storage to callers. */
    private headers(hasBody: boolean): Headers | undefined {
        const token = this.tokenReader.get();
        if (!hasBody && !token) {
            return undefined;
        }
        const headers = new Headers();
        if (hasBody) {
            headers.set('content-type', 'application/json');
        }
        if (token) {
            headers.set('authorization', `Bearer ${token}`);
        }
        return headers;
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

}
