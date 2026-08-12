<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const name = ref('');
const email = ref('');
const password = ref('');
const router = useRouter();

/** Submits the desktop registration form. */
async function submit(): Promise<void> {
    await authComposable.signUp(name.value, email.value, password.value);
    if (authComposable.data.value) {
        await router.push('/account');
    }
}
</script>

<template>
    <section class="desktop-auth">
        <div>
            <p class="eyebrow">Desktop account</p>
            <h1>Create an account.</h1>
        </div>
        <form v-if="authComposable.registrationEnabled" class="auth-form" @submit.prevent="submit">
            <fieldset>
                <legend>Desktop registration</legend>
                <label>Name<input v-model="name" autocomplete="name" required></label>
                <label>
                    Email<input v-model="email" type="email" autocomplete="email" required>
                    <small>Use the address for this workspace.</small>
                </label>
                <label>
                    Password<input v-model="password" type="password" autocomplete="new-password" minlength="8" required>
                    <small>Choose at least eight characters for this desktop account.</small>
                </label>
            </fieldset>
            <p v-if="authComposable.error.value" role="alert">{{ authComposable.error.value.message }}</p>
            <button type="submit">Register</button>
            <RouterLink to="/sign-in">Sign in instead</RouterLink>
        </form>
        <p v-else>Registration is not available for this deployment.</p>
    </section>
</template>

<style scoped>
.desktop-auth { display: grid; grid-template-columns: 1fr 24rem; gap: var(--space-8); }
.auth-form, fieldset { display: grid; gap: var(--space-3); }
</style>
