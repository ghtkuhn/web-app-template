<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const email = ref('');
const password = ref('');
const router = useRouter();

/** Submits the desktop sign-in form. */
async function submit(): Promise<void> {
    await authComposable.signIn(email.value, password.value);
    if (authComposable.data.value) {
        await router.push('/account');
    }
}
</script>

<template>
    <section class="desktop-auth">
        <div>
            <p class="eyebrow">Desktop account</p>
            <h1>Sign in.</h1>
            <p class="page-copy">Continue in your protected workspace.</p>
        </div>
        <form v-if="authComposable.enabled" class="auth-form" @submit.prevent="submit">
            <label>Email<input v-model="email" type="email" required></label>
            <label>Password<input v-model="password" type="password" required></label>
            <p v-if="authComposable.error.value">{{ authComposable.error.value.message }}</p>
            <button type="submit" :disabled="authComposable.status.value === 'loading'">Sign in</button>
            <RouterLink v-if="authComposable.registrationEnabled" to="/sign-up">Create account</RouterLink>
        </form>
        <p v-else>Authentication is disabled for this deployment.</p>
    </section>
</template>

<style scoped>
.desktop-auth { display: grid; grid-template-columns: 1fr 24rem; gap: var(--space-8); }
.auth-form, label { display: grid; gap: var(--space-3); }
.auth-form { padding: var(--space-6); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-panel); }
</style>
