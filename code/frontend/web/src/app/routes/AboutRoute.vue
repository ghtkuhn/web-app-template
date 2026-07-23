<script setup lang="ts">
import DesktopAboutView from '../../presentation/desktop/views/AboutView.vue';
import TabletAboutView from '../../presentation/tablet/views/AboutView.vue';
import MobileAboutView from '../../presentation/mobile/views/AboutView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopAboutView"
        :tablet="TabletAboutView"
        :mobile="MobileAboutView"
    />
</template>
