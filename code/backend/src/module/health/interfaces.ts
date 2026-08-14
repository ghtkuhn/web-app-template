import type { HandlerResult } from '../../base/interfaces.ts';
import type { HealthStatusDTO } from './dto/health-status.dto.ts';
import type { HealthNodeRequest } from './types.ts';

/** Public in-process contract exposed to modules that depend on health. */
export interface HealthModulePort {
    dispatch(
        type: 'node',
        input: HealthNodeRequest,
    ): Promise<HandlerResult<HealthStatusDTO>>;
}

/** Stateless dependencies shared by the Health Service and its Operations. */
export interface HealthServiceDependencies {}
