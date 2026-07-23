import { BaseService } from '../../../base/base.service.ts';
import { HealthStatusDTO } from '../dto/health-status.dto.ts';

/**
 * Provides the application's process-level health state.
 *
 * Health is intentionally stateless and therefore does not introduce an artificial
 * store. The `never` base parameters document that persistence APIs are unavailable
 * to this service.
 */
export class HealthService extends BaseService<never, never> {
    /** Creates a health service without a persistence dependency. */
    constructor() {
        super(undefined as never);
    }

    /** Returns a successful process health indicator. */
    public getStatus(): HealthStatusDTO {
        return new HealthStatusDTO('ok');
    }
}
