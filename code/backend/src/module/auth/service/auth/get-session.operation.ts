import { BaseServiceOperation } from '../../../../base/base.service.operation.ts';
import { AuthSessionDTO } from '../../dto/auth-session.dto.ts';
import { AuthUserDTO } from '../../dto/auth-user.dto.ts';
import type { AuthServiceDependencies } from '../../interfaces.ts';
import type { AuthSessionInput } from '../../types.ts';

/** Resolves one signed Bearer session into safe public DTOs. */
export class GetSessionOperation extends BaseServiceOperation<
    AuthSessionInput,
    AuthSessionDTO | null,
    AuthServiceDependencies
> {
    /** Returns the active safe session representation when it exists. */
    public async execute(
        input: AuthSessionInput,
    ): Promise<AuthSessionDTO | null> {
        const headers = new Headers({
            Authorization: `Bearer ${input.bearerToken}`,
        });
        const result = await this.dependencies.runtime.api.getSession({
            headers,
        });
        return result
            ? new AuthSessionDTO(
                  result.session,
                  new AuthUserDTO(result.user),
              )
            : null;
    }
}
