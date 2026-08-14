import { BaseService } from '../../../base/base.service.ts';
import { GetHealthOperation } from './health/get-health.operation.ts';
import type { HealthServiceDependencies } from '../interfaces.ts';

/** Generated Router for health Service Operations. */
export class HealthService extends BaseService {
    private readonly getHealthOperation: GetHealthOperation;

    /** Creates every owner-bound Operation with shared dependencies. */
    public constructor(dependencies: HealthServiceDependencies) {
        super();
        this.getHealthOperation =
            new GetHealthOperation(dependencies);
    }

    /** Routes the get-health application operation. */
    public getHealth(): ReturnType<GetHealthOperation['execute']> {
        return this.getHealthOperation.execute(undefined);
    }
}
