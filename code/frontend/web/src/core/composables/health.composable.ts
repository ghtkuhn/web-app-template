import { readonly, ref, type Ref } from 'vue';
import { ApiClient } from '../api/api.client.ts';
import type { ApiError } from '../api/interfaces.ts';
import { frontendConfig } from '../config/frontend.config.ts';
import type { HealthModel } from '../models/health.model.ts';
import { HealthService } from '../services/health.service.ts';
import type { AsyncState, AsyncStatus } from './interfaces.ts';

/** Persistent Health state shared by every presentation. */
export class HealthComposable implements AsyncState<HealthModel> {
    private readonly mutableStatus: Ref<AsyncStatus> = ref('idle');
    private readonly mutableData: Ref<HealthModel | null> = ref(null);
    private readonly mutableError: Ref<ApiError | null> = ref(null);

    public readonly status = readonly(this.mutableStatus);
    public readonly data = readonly(this.mutableData);
    public readonly error = readonly(this.mutableError);

    public constructor(private readonly service: HealthService) {}

    /** Loads Health and replaces the current async state atomically. */
    public async load(signal?: AbortSignal): Promise<void> {
        this.mutableStatus.value = 'loading';
        this.mutableError.value = null;
        const result = await this.service.getHealth(signal);
        if (result.success) {
            this.mutableData.value = result.data;
            this.mutableStatus.value = 'success';
            return;
        }
        this.mutableData.value = null;
        this.mutableError.value = result.error;
        this.mutableStatus.value = 'error';
    }
}

const healthService = new HealthService(
    new ApiClient(frontendConfig.apiBaseUrl),
);

/** Shared Health composable whose state survives presentation remounts. */
export const healthComposable = new HealthComposable(healthService);
