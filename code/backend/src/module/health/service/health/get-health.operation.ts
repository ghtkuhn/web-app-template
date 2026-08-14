import { BaseServiceOperation } from '../../../../base/base.service.operation.ts';
import { HealthStatusDTO } from '../../dto/health-status.dto.ts';
import type { HealthServiceDependencies } from '../../interfaces.ts';

/** Returns the process-level application health state. */
export class GetHealthOperation extends BaseServiceOperation<
    void,
    HealthStatusDTO,
    HealthServiceDependencies
> {
    /** Creates the stable successful health response. */
    public execute(_input: void): HealthStatusDTO {
        return new HealthStatusDTO('ok');
    }
}
