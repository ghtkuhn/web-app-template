<script setup lang="ts">
import DesktopNotFoundView from '../../presentation/desktop/views/NotFoundView.vue';
import TabletNotFoundView from '../../presentation/tablet/views/NotFoundView.vue';
import MobileNotFoundView from '../../presentation/mobile/views/NotFoundView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopNotFoundView"
        :tablet="TabletNotFoundView"
        :mobile="MobileNotFoundView"
    />
</template>
