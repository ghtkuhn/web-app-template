<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <section class="page mobile-not-found">
        <p class="eyebrow">404 · Mobile</p>
        <h1>Page not found.</h1>
        <RouterLink class="action-link" to="/">Return home</RouterLink>
    </section>
</template>

<style scoped>
.mobile-not-found {
    max-width: 28rem;
}
</style>
