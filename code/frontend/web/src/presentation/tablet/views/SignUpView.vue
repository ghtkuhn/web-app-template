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
            <fieldset class="border-0 p-0 m-0">
                <legend>Tablet details</legend>
                <label class="form-label">Name<input v-model="name" class="form-control" autocomplete="name" required></label>
                <label class="form-label">
                    Email<input v-model="email" class="form-control" type="email" autocomplete="email" required>
                    <small class="form-text">We use this address to identify your account.</small>
                </label>
                <label class="form-label">
                    Password<input v-model="password" class="form-control" type="password" autocomplete="new-password" minlength="8" required>
                    <small class="form-text">Use eight or more characters to protect this account.</small>
                </label>
            </fieldset>
            <p v-if="authComposable.error.value" class="alert alert-danger" role="alert">{{ authComposable.error.value.message }}</p>
            <button class="btn btn-primary" type="submit" :aria-busy="authComposable.status.value === 'loading'" :disabled="authComposable.status.value === 'loading'">Register</button>
            <RouterLink class="btn btn-link px-0" to="/sign-in">Sign in instead</RouterLink>
        </form>
        <p v-else class="alert alert-secondary">Registration is not available for this deployment.</p>
    </section>
</template>

<style scoped>
.tablet-auth, form, fieldset { display: grid; gap: var(--space-3); }
form { max-width: 30rem; margin-top: var(--space-8); }
</style>
