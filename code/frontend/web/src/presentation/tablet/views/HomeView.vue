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
        <article class="health-card card" aria-labelledby="tablet-health-title">
            <header class="card-header">
                <strong id="tablet-health-title">Backend health</strong>
            </header>
            <div class="card-body">
                <p>{{ healthComposable.data.value?.status ?? healthComposable.status.value }}</p>
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
.tablet-home {
    padding-right: var(--space-8);
}

.health-card {
    margin-top: var(--space-6);
}
</style>
