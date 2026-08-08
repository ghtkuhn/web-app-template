import { createRouter, createWebHistory } from 'vue-router';
import HomeRoute from './routes/HomeRoute.vue';
import AboutRoute from './routes/AboutRoute.vue';
import NotFoundRoute from './routes/NotFoundRoute.vue';
import SignInRoute from './routes/SignInRoute.vue';
import SignUpRoute from './routes/SignUpRoute.vue';
import AccountRoute from './routes/AccountRoute.vue';
import { frontendConfig } from '../core/config/frontend.config.ts';
import { authComposable } from '../core/composables/auth.composable.ts';

/** Shared routes whose adapters select the active presentation view. */
export const router = createRouter({
    history: createWebHistory(frontendConfig.routerBaseUrl),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeRoute,
        },
        {
            path: '/about',
            name: 'about',
            component: AboutRoute,
        },
        {
            path: '/sign-in',
            name: 'sign-in',
            component: SignInRoute,
        },
        {
            path: '/sign-up',
            name: 'sign-up',
            component: SignUpRoute,
        },
        {
            path: '/account',
            name: 'account',
            component: AccountRoute,
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'not-found',
            component: NotFoundRoute,
        },
    ],
});

router.beforeEach(async (target) => {
    if (authComposable.status.value === 'idle') {
        await authComposable.restore();
    }
    const authenticated = authComposable.data.value !== null;
    if (target.name === 'account' && !authenticated) {
        return { name: 'sign-in' };
    }
    if (
        authenticated &&
        (target.name === 'sign-in' || target.name === 'sign-up')
    ) {
        return { name: 'account' };
    }
    return true;
});
