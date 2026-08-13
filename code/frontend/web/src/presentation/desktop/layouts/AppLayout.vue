<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';
</script>

<template>
    <div class="desktop-shell">
        <header class="desktop-header">
            <RouterLink class="desktop-brand" to="/">Web App</RouterLink>
            <nav class="desktop-navigation" aria-label="Desktop navigation">
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
        <main class="desktop-content" id="main-content">
            <slot />
        </main>
    </div>
</template>

<style scoped>
.desktop-shell {
    width: min(1120px, calc(100% - 4rem));
    margin: 0 auto;
}

.desktop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 6rem;
    border-bottom: var(--border-width) solid var(--color-border);
}

.desktop-brand {
    font-size: var(--font-size-body);
    font-weight: 800;
    text-decoration: none;
}

.desktop-navigation {
    display: flex;
    gap: 32px;
}

.desktop-navigation a {
    color: var(--color-muted);
}

.desktop-navigation [aria-current="page"] {
    color: var(--color-accent);
}

.desktop-content {
    padding: 128px 0;
}
</style>
