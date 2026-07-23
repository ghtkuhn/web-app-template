<script setup lang="ts">
import { healthComposable } from '../../../core/composables/health.composable.ts';
</script>

<template>
    <section class="page tablet-home">
        <p class="eyebrow">Tablet presentation</p>
        <h1>Balanced for touch and focus.</h1>
        <p class="page-copy">
            Tablet keeps navigation compact while retaining enough room for
            focused multi-column content when features need it.
        </p>
        <button
            class="health-action"
            type="button"
            @click="healthComposable.load()"
        >
            Backend:
            {{ healthComposable.data.value?.status ?? healthComposable.status.value }}
        </button>
    </section>
</template>

<style scoped>
.tablet-home {
    padding-right: var(--space-8);
}

.health-action {
    margin-top: var(--space-6);
}
</style>
