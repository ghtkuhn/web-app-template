import { BaseService } from '../../../base/base.service.ts';
import { CreateAuthRuntimeOperation } from './auth-runtime/create-auth-runtime.operation.ts';
import type { AuthRuntimeServiceDependencies } from '../interfaces.ts';

/** Generated Router for auth-runtime Service Operations. */
export class AuthRuntimeService extends BaseService {
    private readonly createAuthRuntimeOperation: CreateAuthRuntimeOperation;

    /** Creates every owner-bound Operation with shared dependencies. */
    public constructor(dependencies: AuthRuntimeServiceDependencies) {
        super();
        this.createAuthRuntimeOperation =
            new CreateAuthRuntimeOperation(dependencies);
    }

    /** Routes the create-auth-runtime application operation. */
    public createAuthRuntime(): ReturnType<CreateAuthRuntimeOperation['execute']> {
        return this.createAuthRuntimeOperation.execute(undefined);
    }
}
