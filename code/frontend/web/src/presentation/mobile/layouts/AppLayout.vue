<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <div class="mobile-shell">
        <header class="mobile-header">
            <RouterLink class="mobile-brand" to="/">Web App</RouterLink>
        </header>
        <main class="mobile-content">
            <slot />
        </main>
        <nav class="mobile-navigation" aria-label="Mobile navigation">
            <RouterLink to="/">Home</RouterLink>
            <RouterLink to="/about">About</RouterLink>
        </nav>
    </div>
</template>

<style scoped>
.mobile-shell {
    min-height: 100vh;
    padding: 0 1.25rem 5rem;
}

.mobile-header {
    display: flex;
    align-items: center;
    min-height: 4.5rem;
    border-bottom: var(--border-width) solid var(--color-border);
}

.mobile-brand {
    font-weight: 800;
    text-decoration: none;
}

.mobile-content {
    padding: 3.5rem 0;
}

.mobile-navigation {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--layer-navigation);
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
}

.mobile-navigation a {
    min-height: 3.75rem;
    display: grid;
    place-items: center;
    color: var(--color-muted);
    text-decoration: none;
}

.mobile-navigation [aria-current="page"] {
    color: var(--color-accent);
    font-weight: 750;
}
</style>
