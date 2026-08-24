<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';
</script>

<template>
    <div class="mobile-shell">
        <header class="mobile-header">
            <RouterLink class="mobile-brand navbar-brand" to="/">Web App</RouterLink>
        </header>
        <main class="mobile-content" id="main-content">
            <slot />
        </main>
        <nav class="mobile-navigation nav" aria-label="Mobile navigation">
            <RouterLink class="nav-link" to="/">Home</RouterLink>
            <RouterLink class="nav-link" to="/about">About</RouterLink>
            <RouterLink
                v-if="authComposable.enabled"
                class="nav-link"
                :to="authComposable.data.value ? '/account' : '/sign-in'"
            >
                {{ authComposable.data.value ? 'Account' : 'Sign in' }}
            </RouterLink>
        </nav>
    </div>
</template>

<style scoped>
.mobile-shell {
    min-height: 100vh;
    padding: 0 20px 80px;
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
    padding: 56px 0;
}

.mobile-navigation {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--layer-navigation);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-surface);
}

.mobile-navigation a {
    min-height: 3.75rem;
    display: grid;
    place-items: center;
    color: var(--color-muted);
}

.mobile-navigation [aria-current="page"] {
    color: var(--color-accent);
    font-weight: 750;
}
</style>
