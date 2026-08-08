<script setup lang="ts">
import { useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const router = useRouter();
async function signOut(): Promise<void> {
    await authComposable.signOut();
    await router.push('/sign-in');
}
</script>

<template>
    <section class="mobile-account">
        <p class="eyebrow">Mobile account</p><h1>Your account.</h1>
        <article v-if="authComposable.data.value">
            <strong>{{ authComposable.data.value.name }}</strong><span>{{ authComposable.data.value.email }}</span>
            <button type="button" @click="signOut">Sign out</button>
        </article>
    </section>
</template>

<style scoped>
.mobile-account, article { display: grid; gap: var(--space-3); }
article { margin-top: var(--space-6); padding: var(--space-5); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-panel); }
button { min-height: 3rem; }
</style>
