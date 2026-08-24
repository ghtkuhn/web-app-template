<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { authComposable } from '../../../core/composables/auth.composable.ts';

const email = ref('');
const password = ref('');
const router = useRouter();
async function submit(): Promise<void> {
    await authComposable.signIn(email.value, password.value);
    if (authComposable.data.value) {
        await router.push('/account');
    }
}
</script>

<template>
    <section class="tablet-auth">
        <p class="eyebrow">Tablet account</p>
        <h1>Sign in.</h1>
        <form v-if="authComposable.enabled" @submit.prevent="submit">
            <fieldset class="border-0 p-0 m-0">
                <label class="form-label">Email<input v-model="email" class="form-control" type="email" autocomplete="email" required></label>
                <label class="form-label">Password<input v-model="password" class="form-control" type="password" autocomplete="current-password" required></label>
            </fieldset>
            <p v-if="authComposable.error.value" class="alert alert-danger" role="alert">{{ authComposable.error.value.message }}</p>
            <button class="btn btn-primary" type="submit" :aria-busy="authComposable.status.value === 'loading'" :disabled="authComposable.status.value === 'loading'">Sign in</button>
            <RouterLink v-if="authComposable.registrationEnabled" class="btn btn-link px-0" to="/sign-up">Create account</RouterLink>
        </form>
        <p v-else class="alert alert-secondary">Authentication is disabled for this deployment.</p>
    </section>
</template>

<style scoped>
.tablet-auth, form, fieldset { display: grid; gap: var(--space-3); }
form { max-width: 30rem; margin-top: var(--space-8); }
</style>
