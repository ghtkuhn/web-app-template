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
    <section class="tablet-account">
        <p class="eyebrow">Tablet account</p><h1>Your account.</h1>
        <article v-if="authComposable.data.value">
            <strong>{{ authComposable.data.value.name }}</strong><span>{{ authComposable.data.value.email }}</span>
            <button type="button" @click="signOut">Sign out</button>
        </article>
    </section>
</template>

<style scoped>
.tablet-account, article { display: grid; gap: var(--space-3); }
article { max-width: 30rem; margin-top: var(--space-8); padding: var(--space-6); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-panel); }
</style>
