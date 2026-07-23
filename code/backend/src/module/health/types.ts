import type { NodeRequestContext } from '../../base/interfaces.ts';

/** Supported in-process requests exposed by the health module. */
export type HealthNodeRequest = {
    operation: 'getStatus';
    context: NodeRequestContext;
};
