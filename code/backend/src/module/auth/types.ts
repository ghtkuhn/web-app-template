import type { NodeRequestContext } from '../../base/interfaces.ts';

/** In-process Auth operations exposed to other modules. */
export type AuthNodeRequest = {
    operation: 'getSession';
    context: NodeRequestContext;
    bearerToken: string;
};

/** Internal typed input for signed Bearer-session lookup. */
export type AuthSessionInput = {
    readonly bearerToken: string;
};
