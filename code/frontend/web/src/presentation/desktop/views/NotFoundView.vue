<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <section class="page desktop-not-found">
        <p class="eyebrow">404 · Desktop</p>
        <h1>This workspace does not exist.</h1>
        <RouterLink class="action-link btn btn-outline-primary" to="/">Return home</RouterLink>
    </section>
</template>

<style scoped>
.desktop-not-found {
    max-width: 52rem;
}
</style>
