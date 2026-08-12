<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const name = ref('');
const email = ref('');
const password = ref('');
const router = useRouter();

/** Submits the mobile registration form. */
async function submit(): Promise<void> {
    await authComposable.signUp(name.value, email.value, password.value);
    if (authComposable.data.value) {
        await router.push('/account');
    }
}
</script>

<template>
    <section class="mobile-auth">
        <p class="eyebrow">Mobile account</p>
        <h1>Create an account.</h1>
        <form v-if="authComposable.registrationEnabled" @submit.prevent="submit">
            <fieldset>
                <legend>Mobile account setup</legend>
                <label>Name<input v-model="name" autocomplete="name" required></label>
                <label>
                    Email<input v-model="email" type="email" autocomplete="email" required>
                    <small>Enter an address you can access.</small>
                </label>
                <label>
                    Password<input v-model="password" type="password" autocomplete="new-password" minlength="8" required>
                    <small>Use eight characters or more for a secure sign-in.</small>
                </label>
            </fieldset>
            <p v-if="authComposable.error.value" role="alert">{{ authComposable.error.value.message }}</p>
            <button type="submit" :aria-busy="authComposable.status.value === 'loading'" :disabled="authComposable.status.value === 'loading'">Register</button>
            <RouterLink to="/sign-in">Sign in instead</RouterLink>
        </form>
        <p v-else>Registration is not available for this deployment.</p>
    </section>
</template>

<style scoped>
.mobile-auth, form, fieldset { display: grid; gap: var(--space-3); }
form { margin-top: var(--space-6); }
input, button { min-height: 3rem; }
</style>
