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
        <article class="health-card" aria-labelledby="mobile-health-title">
            <header><strong id="mobile-health-title">Backend health</strong></header>
            <p>{{ healthComposable.data.value?.status ?? healthComposable.status.value }}</p>
            <p v-if="healthComposable.error.value" role="alert">{{ healthComposable.error.value }}</p>
            <footer><button type="button" @click="healthComposable.load()">Check health</button></footer>
        </article>
    </section>
</template>

<style scoped>
.mobile-home {
    display: flex;
    flex-direction: column;
}

.health-card {
    margin-top: var(--space-5);
}
</style>
