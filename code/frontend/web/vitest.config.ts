import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/** Unit and Vue component test configuration. */
export default defineConfig({
    plugins: [vue()],
    test: {
        environment: 'happy-dom',
        include: ['test/**/*.test.ts'],
    },
});
