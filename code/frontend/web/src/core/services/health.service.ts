import { ApiClient } from '../api/api.client.ts';
import type { paths } from '../api/generated/schema.ts';
import type { ApiResult } from '../api/interfaces.ts';
import type { HealthModel } from '../models/health.model.ts';

type HealthResponse =
    paths['/api/health']['get']['responses'][200]['content']['application/json'];

/** Maps the generated Health transport contract to a frontend model. */
export class HealthService {
    public constructor(private readonly apiClient: ApiClient) {}

    /** Reads the current backend Health state. */
    public async getHealth(
        signal?: AbortSignal,
    ): Promise<ApiResult<HealthModel>> {
        const result = await this.apiClient.request<HealthResponse>(
            '/api/health',
            { signal },
        );
        if (!result.success) {
            return result;
        }
        return {
            success: true,
            data: {
                status: result.data.data.status,
            },
        };
    }
}
