export type ApiError =
    | { readonly type: 'abort'; readonly message: string }
    | { readonly type: 'http'; readonly message: string; readonly status: number }
    | { readonly type: 'network'; readonly message: string }
    | { readonly type: 'parse'; readonly message: string };

export type ApiResult<T> =
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: ApiError };

export interface ApiRequest {
    readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly body?: unknown;
    readonly signal?: AbortSignal;
}

/** Read-only Bearer-token dependency consumed by HTTP transports. */
export interface AuthTokenReader {
    get(): string | null;
}
