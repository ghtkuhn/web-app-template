<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <section class="page tablet-not-found">
        <p class="eyebrow">404 · Tablet</p>
        <h1>The requested page is unavailable.</h1>
        <RouterLink class="action-link" to="/">Return home</RouterLink>
    </section>
</template>

<style scoped>
.tablet-not-found {
    max-width: 40rem;
}
</style>
