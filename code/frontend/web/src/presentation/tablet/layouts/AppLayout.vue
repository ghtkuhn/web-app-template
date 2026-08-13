<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';
</script>

<template>
    <div class="tablet-shell">
        <header class="tablet-header">
            <RouterLink class="tablet-brand" to="/">Web App</RouterLink>
            <nav class="tablet-navigation" aria-label="Tablet navigation">
                <RouterLink to="/">Home</RouterLink>
                <RouterLink to="/about">About</RouterLink>
                <RouterLink
                    v-if="authComposable.enabled"
                    :to="authComposable.data.value ? '/account' : '/sign-in'"
                >
                    {{ authComposable.data.value ? 'Account' : 'Sign in' }}
                </RouterLink>
            </nav>
        </header>
        <main class="tablet-content" id="main-content">
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
    gap: 24px;
}

.tablet-navigation a {
    color: var(--color-muted);
}

.tablet-navigation [aria-current="page"] {
    color: var(--color-accent);
}

.tablet-content {
    padding: 96px 0;
}
</style>
