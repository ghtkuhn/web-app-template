import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import { toTransportApiError } from '../src/core/api/api-error.ts';
import { ApiClient } from '../src/core/api/api.client.ts';
import { FrontendConfig } from '../src/core/config/frontend.config.ts';
import { HealthComposable } from '../src/core/composables/health.composable.ts';
import { HealthService } from '../src/core/services/health.service.ts';
import {
    authTokenStore,
    AuthTokenStore,
} from '../src/core/api/auth-token.store.ts';
import { createFrontendAuthClient } from '../src/core/api/auth.client.ts';
import { AuthComposable } from '../src/core/composables/auth.composable.ts';
import { AuthService } from '../src/core/services/auth.service.ts';

beforeEach(() => {
    authTokenStore.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function authClientWithRejectedTransport(error: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => {
        throw error;
    }) as typeof fetch);
    return createFrontendAuthClient('http://backend.test');
}

describe('FrontendConfig', () => {
    test('uses safe defaults and validates presentation locks', () => {
        const config = FrontendConfig.fromEnvironment({});
        expect(config.apiBaseUrl).toBe('/');
        expect(config.routerBaseUrl).toBe('/');
        expect(config.presentationLock).toBeNull();
        expect(config.authEnabled).toBe(false);
        expect(config.registrationEnabled).toBe(false);
        expect(() => FrontendConfig.fromEnvironment({
            VITE_PRESENTATION_LOCK: 'watch',
        })).toThrow(/Invalid VITE_PRESENTATION_LOCK/);
    });

    test('prefers public runtime deployment configuration', () => {
        const config = FrontendConfig.fromEnvironment(
            {
                VITE_API_BASE_URL: 'https://build.example',
                VITE_PRESENTATION_LOCK: 'desktop',
            },
            {
                apiBaseUrl: 'https://api.runtime.example',
                webSocketUrl: 'wss://ws.runtime.example',
                presentationLock: 'mobile',
                authEnabled: true,
                registrationEnabled: false,
            },
        );
        expect(config.apiBaseUrl).toBe('https://api.runtime.example');
        expect(config.webSocketUrl).toBe('wss://ws.runtime.example');
        expect(config.presentationLock).toBe('mobile');
        expect(config.authEnabled).toBe(true);
        expect(config.registrationEnabled).toBe(false);
    });
});

test('AuthTokenStore owns tab-local Bearer credentials', () => {
    const store = new AuthTokenStore();
    store.clear();
    expect(store.get()).toBeNull();
    store.set('signed-token');
    expect(store.get()).toBe('signed-token');
    store.clear();
    expect(store.get()).toBeNull();
});

test('disabled Auth performs no request and reports unavailable registration', async () => {
    const composable = new AuthComposable(
        new AuthService(createFrontendAuthClient('http://backend.test')),
        false,
        false,
    );
    await composable.restore();
    expect(composable.status.value).toBe('success');
    await composable.signUp('Name', 'user@example.com', 'password');
    expect(composable.status.value).toBe('error');
    expect(composable.error.value?.message).toBe(
        'Registration is not available.',
    );
});

describe('ApiClient', () => {
    test('normalizes rejected transports without exposing unknown values', () => {
        expect(toTransportApiError(
            new DOMException('cancelled', 'AbortError'),
        )).toEqual({
            type: 'abort',
            message: 'The request was aborted.',
        });
        expect(toTransportApiError(new Error('offline'))).toEqual({
            type: 'network',
            message: 'offline',
        });
        expect(toTransportApiError('sensitive rejected value')).toEqual({
            type: 'network',
            message: 'The network request failed.',
        });
    });

    test('normalizes success, HTTP, parse, network, and abort outcomes', async () => {
        const success = new ApiClient(
            '/',
            vi.fn(async () => new Response('{"value":1}')) as typeof fetch,
            'http://frontend.test',
        );
        await expect(success.request<{ value: number }>('/ok')).resolves.toEqual({
            success: true,
            data: { value: 1 },
        });

        const http = new ApiClient(
            '/',
            vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch,
            'http://frontend.test',
        );
        expect(await http.request('/fail')).toMatchObject({
            success: false,
            error: { type: 'http', status: 503 },
        });

        const parse = new ApiClient(
            '/',
            vi.fn(async () => new Response('invalid')) as typeof fetch,
            'http://frontend.test',
        );
        expect(await parse.request('/invalid')).toMatchObject({
            success: false,
            error: { type: 'parse' },
        });

        const network = new ApiClient(
            '/',
            vi.fn(async () => {
                throw new Error('offline');
            }) as typeof fetch,
            'http://frontend.test',
        );
        expect(await network.request('/offline')).toMatchObject({
            success: false,
            error: { type: 'network' },
        });

        const aborted = new ApiClient(
            '/',
            vi.fn(async () => {
                throw new DOMException('aborted', 'AbortError');
            }) as typeof fetch,
            'http://frontend.test',
        );
        expect(await aborted.request('/abort')).toMatchObject({
            success: false,
            error: { type: 'abort' },
        });
    });
});

describe('AuthService', () => {
    test('normalizes session transport failures and clears stale credentials', async () => {
        const authClient = authClientWithRejectedTransport(
            new Error('backend unavailable'),
        );
        authTokenStore.set('stale-token');

        await expect(new AuthService(authClient).getSession()).resolves.toEqual({
            success: false,
            error: { type: 'network', message: 'backend unavailable' },
        });
        expect(authTokenStore.get()).toBeNull();
    });

    test('normalizes sign-in and sign-up transport failures', async () => {
        const authClient = authClientWithRejectedTransport(
            new DOMException('cancelled', 'AbortError'),
        );
        const service = new AuthService(authClient);

        await expect(service.signIn('user@example.com', 'password')).resolves
            .toMatchObject({
                success: false,
                error: { type: 'abort' },
            });
        await expect(
            service.signUp('User', 'user@example.com', 'password'),
        ).resolves.toMatchObject({
            success: false,
            error: { type: 'abort' },
        });
    });

    test('keeps returned Auth errors classified as HTTP failures', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ message: 'Invalid credentials.' }),
            {
                status: 401,
                headers: { 'content-type': 'application/json' },
            },
        )) as typeof fetch);
        const authClient = createFrontendAuthClient('http://backend.test');

        await expect(
            new AuthService(authClient).signIn(
                'user@example.com',
                'password',
            ),
        ).resolves.toEqual({
            success: false,
            error: {
                type: 'http',
                status: 401,
                message: 'Invalid credentials.',
            },
        });
    });

    test('always clears local credentials when sign-out transport fails', async () => {
        const authClient = authClientWithRejectedTransport(
            new Error('offline'),
        );
        authTokenStore.set('active-token');

        await expect(new AuthService(authClient).signOut()).resolves.toEqual({
            success: false,
            error: { type: 'network', message: 'offline' },
        });
        expect(authTokenStore.get()).toBeNull();
    });

    test('lets AuthComposable restore settle in an error state', async () => {
        const authClient = authClientWithRejectedTransport(
            new Error('offline'),
        );
        const composable = new AuthComposable(
            new AuthService(authClient),
            true,
            false,
        );

        await expect(composable.restore()).resolves.toBeUndefined();
        expect(composable.status.value).toBe('error');
        expect(composable.data.value).toBeNull();
        expect(composable.error.value).toEqual({
            type: 'network',
            message: 'offline',
        });
    });
});

test('HealthComposable exposes loading, success, and error state', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn(
        () => new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        }),
    ) as typeof fetch;
    const composable = new HealthComposable(
        new HealthService(
            new ApiClient('/', fetchImplementation, 'http://frontend.test'),
        ),
    );
    const pending = composable.load();
    expect(composable.status.value).toBe('loading');
    resolveFetch?.(new Response(
        '{"success":true,"data":{"status":"ok"}}',
    ));
    await pending;
    expect(composable.status.value).toBe('success');
    expect(composable.data.value).toEqual({ status: 'ok' });
});
