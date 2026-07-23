<script setup lang="ts">
import DesktopHomeView from '../../presentation/desktop/views/HomeView.vue';
import TabletHomeView from '../../presentation/tablet/views/HomeView.vue';
import MobileHomeView from '../../presentation/mobile/views/HomeView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopHomeView"
        :tablet="TabletHomeView"
        :mobile="MobileHomeView"
    />
</template>
