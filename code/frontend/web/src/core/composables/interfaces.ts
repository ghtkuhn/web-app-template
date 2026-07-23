import type { Ref } from 'vue';
import type { ApiError } from '../api/interfaces.ts';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
    readonly status: Readonly<Ref<AsyncStatus>>;
    readonly data: Readonly<Ref<T | null>>;
    readonly error: Readonly<Ref<ApiError | null>>;
}
