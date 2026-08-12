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
        <article class="health-card" aria-labelledby="tablet-health-title">
            <header>
                <strong id="tablet-health-title">Backend health</strong>
            </header>
            <p>{{ healthComposable.data.value?.status ?? healthComposable.status.value }}</p>
            <p v-if="healthComposable.error.value" role="alert">
                {{ healthComposable.error.value }}
            </p>
            <footer>
                <button type="button" @click="healthComposable.load()">
                    Check health
                </button>
            </footer>
        </article>
    </section>
</template>

<style scoped>
.tablet-home {
    padding-right: var(--space-8);
}

.health-card {
    margin-top: var(--space-6);
}
</style>
