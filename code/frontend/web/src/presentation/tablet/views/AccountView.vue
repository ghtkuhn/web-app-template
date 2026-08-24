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
        <p class="eyebrow">Tablet account</p>
        <h1>Your account.</h1>
        <article v-if="authComposable.data.value" class="card">
            <header class="card-header"><strong>{{ authComposable.data.value.name }}</strong></header>
            <div class="card-body"><p class="card-text">{{ authComposable.data.value.email }}</p></div>
            <footer class="card-footer"><button type="button" class="btn btn-outline-secondary" @click="signOut">Sign out</button></footer>
        </article>
    </section>
</template>

<style scoped>
.tablet-account, article { display: grid; gap: var(--space-3); }
article { max-width: 30rem; margin-top: var(--space-8); }
</style>
