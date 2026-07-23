<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <div class="tablet-shell">
        <header class="tablet-header">
            <RouterLink class="tablet-brand" to="/">Web App</RouterLink>
            <nav class="tablet-navigation" aria-label="Tablet navigation">
                <RouterLink to="/">Home</RouterLink>
                <RouterLink to="/about">About</RouterLink>
            </nav>
        </header>
        <main class="tablet-content">
            <slot />
        </main>
    </div>
</template>

<style scoped>
.tablet-shell {
    width: min(840px, calc(100% - 3rem));
    margin: 0 auto;
}

.tablet-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    min-height: 5.5rem;
    border-bottom: var(--border-width) solid var(--color-border);
}

.tablet-brand {
    font-weight: 800;
    text-decoration: none;
}

.tablet-navigation {
    display: flex;
    gap: 1.5rem;
}

.tablet-navigation a {
    color: var(--color-muted);
    text-decoration: none;
}

.tablet-navigation [aria-current="page"] {
    color: var(--color-accent);
}

.tablet-content {
    padding: 6rem 0;
}
</style>
