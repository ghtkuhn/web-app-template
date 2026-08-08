<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const name = ref('');
const email = ref('');
const password = ref('');
const router = useRouter();
async function submit(): Promise<void> {
    await authComposable.signUp(name.value, email.value, password.value);
    if (authComposable.data.value) await router.push('/account');
}
</script>

<template>
    <section class="mobile-auth">
        <p class="eyebrow">Mobile account</p><h1>Create an account.</h1>
        <form v-if="authComposable.registrationEnabled" @submit.prevent="submit">
            <label>Name<input v-model="name" required></label>
            <label>Email<input v-model="email" type="email" required></label>
            <label>Password<input v-model="password" type="password" minlength="8" required></label>
            <p v-if="authComposable.error.value">{{ authComposable.error.value.message }}</p>
            <button type="submit">Register</button><RouterLink to="/sign-in">Sign in instead</RouterLink>
        </form>
        <p v-else>Registration is not available for this deployment.</p>
    </section>
</template>

<style scoped>
.mobile-auth, form, label { display: grid; gap: var(--space-3); }
form { margin-top: var(--space-6); padding: var(--space-5); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-medium); background: var(--color-panel); }
input, button { min-height: 3rem; }
</style>
