import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { describe, expect, test } from 'vitest';
import PresentationOutlet from '../src/app/PresentationOutlet.vue';
import { PRESENTATION_KEY } from '../src/app/presentation.ts';

const Desktop = defineComponent({ template: '<p>desktop-only</p>' });
const Tablet = defineComponent({ template: '<p>tablet-only</p>' });
const Mobile = defineComponent({ template: '<p>mobile-only</p>' });

describe('PresentationOutlet', () => {
    test('reacts to shared presentation state', async () => {
        const presentation = ref<'desktop' | 'tablet' | 'mobile'>('mobile');
        const wrapper = mount(PresentationOutlet, {
            props: {
                desktop: Desktop,
                tablet: Tablet,
                mobile: Mobile,
            },
            global: {
                provide: {
                    [PRESENTATION_KEY as symbol]: presentation,
                },
            },
        });

        expect(wrapper.text()).toContain('mobile-only');
        presentation.value = 'desktop';
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toContain('desktop-only');
    });
});
