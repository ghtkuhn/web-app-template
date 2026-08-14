import { BaseService } from '../../../base/base.service.ts';
import { GetSessionOperation } from './auth/get-session.operation.ts';
import type { AuthServiceDependencies } from '../interfaces.ts';

/** Generated Router for auth Service Operations. */
export class AuthService extends BaseService {
    private readonly getSessionOperation: GetSessionOperation;

    /** Creates every owner-bound Operation with shared dependencies. */
    public constructor(dependencies: AuthServiceDependencies) {
        super();
        this.getSessionOperation =
            new GetSessionOperation(dependencies);
    }

    /** Routes the get-session application operation. */
    public getSession(
        input: Parameters<GetSessionOperation['execute']>[0],
    ): ReturnType<GetSessionOperation['execute']> {
        return this.getSessionOperation.execute(input);
    }
}
