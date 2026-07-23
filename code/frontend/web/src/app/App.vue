<script setup lang="ts">
import { onBeforeUnmount, provide } from 'vue';
import { RouterView } from 'vue-router';
import DesktopAppLayout from '../presentation/desktop/layouts/AppLayout.vue';
import TabletAppLayout from '../presentation/tablet/layouts/AppLayout.vue';
import MobileAppLayout from '../presentation/mobile/layouts/AppLayout.vue';
import PresentationOutlet from './PresentationOutlet.vue';
import {
    PRESENTATION_KEY,
    PresentationController,
    type DeviceHints,
} from './presentation.ts';
import { frontendConfig } from '../core/config/frontend.config.ts';

const presentationController = new PresentationController(
    window,
    PresentationController.detectDevice(
        navigator as Navigator & DeviceHints,
        frontendConfig.presentationLock ?? undefined,
    ),
);
presentationController.start();
provide(PRESENTATION_KEY, presentationController.presentation);
onBeforeUnmount(() => presentationController.stop());
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopAppLayout"
        :tablet="TabletAppLayout"
        :mobile="MobileAppLayout"
    >
        <RouterView />
    </PresentationOutlet>
</template>
