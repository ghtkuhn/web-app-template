import { describe, expect, test, vi } from 'vitest';
import { ApiClient } from '../src/core/api/api.client.ts';
import { FrontendConfig } from '../src/core/config/frontend.config.ts';
import { HealthComposable } from '../src/core/composables/health.composable.ts';
import { HealthService } from '../src/core/services/health.service.ts';

describe('FrontendConfig', () => {
    test('uses safe defaults and validates presentation locks', () => {
        const config = FrontendConfig.fromEnvironment({});
        expect(config.apiBaseUrl).toBe('/');
        expect(config.routerBaseUrl).toBe('/');
        expect(config.presentationLock).toBeNull();
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
            },
        );
        expect(config.apiBaseUrl).toBe('https://api.runtime.example');
        expect(config.webSocketUrl).toBe('wss://ws.runtime.example');
        expect(config.presentationLock).toBe('mobile');
    });
});

describe('ApiClient', () => {
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
