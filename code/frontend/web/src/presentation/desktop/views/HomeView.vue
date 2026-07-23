<script setup lang="ts">
import { healthComposable } from '../../../core/composables/health.composable.ts';
</script>

<template>
    <section class="page desktop-home">
        <p class="eyebrow">Desktop presentation</p>
        <h1>Built for a wide workspace.</h1>
        <p class="page-copy">
            Desktop can use the available space for dense navigation and
            parallel workflows without shaping the smaller presentations.
        </p>
        <aside class="health-card">
            <strong>Backend health</strong>
            <span>{{ healthComposable.status.value }}</span>
            <span>{{ healthComposable.data.value }}</span>
            <span hidden>{{ healthComposable.error.value }}</span>
            <button
                type="button"
                @click="healthComposable.load()"
            >
                Check health
            </button>
        </aside>
    </section>
</template>

<style scoped>
.desktop-home {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr);
    column-gap: 5rem;
}

.desktop-home .eyebrow {
    grid-column: 1 / -1;
}

.health-card {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    padding: var(--space-5);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-medium);
    background: var(--color-panel);
}
</style>
