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
        <article class="health-card card" aria-labelledby="desktop-health-title">
            <header class="card-header">
                <strong id="desktop-health-title">Backend health</strong>
            </header>
            <div class="card-body">
                <p>{{ healthComposable.status.value }}</p>
                <p>{{ healthComposable.data.value }}</p>
                <p v-if="healthComposable.error.value" class="alert alert-danger mb-0" role="alert">
                    {{ healthComposable.error.value }}
                </p>
            </div>
            <footer class="card-footer">
                <button class="btn btn-primary" type="button" @click="healthComposable.load()">
                    Check health
                </button>
            </footer>
        </article>
    </section>
</template>

<style scoped>
.desktop-home {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr);
    column-gap: 80px;
}

.desktop-home .eyebrow {
    grid-column: 1 / -1;
}

.health-card {
    display: grid;
    gap: var(--space-3);
    align-content: start;
}
</style>
