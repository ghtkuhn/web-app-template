<script setup lang="ts">
import DesktopAccountView from '../../presentation/desktop/views/AccountView.vue';
import TabletAccountView from '../../presentation/tablet/views/AccountView.vue';
import MobileAccountView from '../../presentation/mobile/views/AccountView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopAccountView"
        :tablet="TabletAccountView"
        :mobile="MobileAccountView"
    />
</template>
