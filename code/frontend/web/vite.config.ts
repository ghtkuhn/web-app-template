import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** Vite development and production-build configuration. */
export default defineConfig({
    plugins: [vue()],
    css: {
        preprocessorOptions: {
            scss: {
                quietDeps: true,
            },
        },
    },
});
