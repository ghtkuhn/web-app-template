import { createAuthClient } from 'better-auth/vue';
import { authTokenStore } from './auth-token.store.ts';

/** Creates a Better Auth Vue client with centralized signed-Bearer handling. */
export function createFrontendAuthClient(baseUrl: string) {
    const resolvedBaseUrl = new URL(baseUrl, window.location.origin).origin;
    return createAuthClient({
        baseURL: resolvedBaseUrl,
        fetchOptions: {
            auth: {
                type: 'Bearer',
                token: () => authTokenStore.get() ?? '',
            },
            onSuccess: (context) => {
                const token = context.response.headers.get('set-auth-token');
                if (token) {
                    authTokenStore.set(token);
                }
            },
        },
    });
}

/** Concrete Better Auth Vue client contract used by the Auth Service. */
export type FrontendAuthClient = ReturnType<typeof createFrontendAuthClient>;
