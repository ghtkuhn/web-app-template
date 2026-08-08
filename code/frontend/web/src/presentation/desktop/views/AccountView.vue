<script setup lang="ts">
import { useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const router = useRouter();

/** Ends the current session and returns to sign-in. */
async function signOut(): Promise<void> {
    await authComposable.signOut();
    await router.push('/sign-in');
}
</script>

<template>
    <section class="desktop-account">
        <div><p class="eyebrow">Desktop account</p><h1>Your account.</h1></div>
        <article v-if="authComposable.data.value">
            <strong>{{ authComposable.data.value.name }}</strong>
            <span>{{ authComposable.data.value.email }}</span>
            <button type="button" @click="signOut">Sign out</button>
        </article>
    </section>
</template>

<style scoped>
.desktop-account { display: grid; grid-template-columns: 1fr 24rem; gap: var(--space-8); }
article { display: grid; gap: var(--space-3); padding: var(--space-6); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-panel); }
</style>
