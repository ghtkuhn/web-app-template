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
    if (authComposable.data.value) {
        await router.push('/account');
    }
}
</script>

<template>
    <section class="tablet-auth">
        <p class="eyebrow">Tablet account</p>
        <h1>Create an account.</h1>
        <form v-if="authComposable.registrationEnabled" @submit.prevent="submit">
            <fieldset>
                <legend>Tablet details</legend>
                <label>Name<input v-model="name" autocomplete="name" required></label>
                <label>
                    Email<input v-model="email" type="email" autocomplete="email" required>
                    <small>We use this address to identify your account.</small>
                </label>
                <label>
                    Password<input v-model="password" type="password" autocomplete="new-password" minlength="8" required>
                    <small>Use eight or more characters to protect this account.</small>
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
.tablet-auth, form, fieldset { display: grid; gap: var(--space-3); }
form { max-width: 30rem; margin-top: var(--space-8); }
</style>
