import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { describe, expect, test } from 'vitest';
import PresentationOutlet from '../src/app/PresentationOutlet.vue';
import { PRESENTATION_KEY } from '../src/app/presentation.ts';
import DesktopHomeView from '../src/presentation/desktop/views/HomeView.vue';
import MobileHomeView from '../src/presentation/mobile/views/HomeView.vue';
import TabletHomeView from '../src/presentation/tablet/views/HomeView.vue';

const Desktop = defineComponent({ template: '<p>desktop-only</p>' });
const Tablet = defineComponent({ template: '<p>tablet-only</p>' });
const Mobile = defineComponent({ template: '<p>mobile-only</p>' });
const homeViews = [
    ['desktop', DesktopHomeView],
    ['tablet', TabletHomeView],
    ['mobile', MobileHomeView],
] as const;

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

describe('Bootstrap presentation contracts', () => {
    for (const [presentation, component] of homeViews) {
        test(`${presentation} health UI uses a Bootstrap card and primary action`, () => {
            const wrapper = mount(component);

            expect(wrapper.get('article').classes()).toContain('card');
            expect(wrapper.get('header').classes()).toContain('card-header');
            expect(wrapper.get('.card-body').classes()).toContain('card-body');
            expect(wrapper.get('footer').classes()).toContain('card-footer');
            expect(wrapper.get('button').classes()).toEqual(
                expect.arrayContaining(['btn', 'btn-primary']),
            );
        });
    }
});
