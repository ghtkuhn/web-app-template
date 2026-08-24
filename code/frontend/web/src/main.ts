import { createApp } from 'vue';
import 'bootstrap';
import App from './app/App.vue';
import {
    BootstrapColorModeController,
    SystemColorSchemeSource,
} from './app/bootstrap-color-mode.ts';
import { router } from './app/router.ts';
import './shared/styles/main.scss';

const colorMode = new BootstrapColorModeController(
    document.documentElement,
    typeof window.matchMedia === 'function'
        ? new SystemColorSchemeSource(window.matchMedia.bind(window))
        : null,
);
colorMode.start();

createApp(App).use(router).mount('#app');
