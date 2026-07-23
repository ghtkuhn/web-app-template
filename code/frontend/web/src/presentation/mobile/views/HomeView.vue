<script setup lang="ts">
import { healthComposable } from '../../../core/composables/health.composable.ts';
</script>

<template>
    <section class="page mobile-home">
        <p class="eyebrow">Mobile presentation</p>
        <h1>Focused on the next action.</h1>
        <p class="page-copy">
            Mobile uses a dedicated touch-first flow instead of compressing the
            desktop interface into a narrow viewport.
        </p>
        <button
            class="health-action"
            type="button"
            @click="healthComposable.load()"
        >
            Health:
            {{ healthComposable.data.value?.status ?? healthComposable.status.value }}
        </button>
    </section>
</template>

<style scoped>
.mobile-home {
    display: flex;
    flex-direction: column;
}

.health-action {
    margin-top: var(--space-5);
}
</style>
