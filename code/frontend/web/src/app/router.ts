import { createRouter, createWebHistory } from 'vue-router';
import HomeRoute from './routes/HomeRoute.vue';
import AboutRoute from './routes/AboutRoute.vue';
import NotFoundRoute from './routes/NotFoundRoute.vue';
import { frontendConfig } from '../core/config/frontend.config.ts';

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
            path: '/:pathMatch(.*)*',
            name: 'not-found',
            component: NotFoundRoute,
        },
    ],
});
