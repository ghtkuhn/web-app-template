<script setup lang="ts">
import DesktopSignInView from '../../presentation/desktop/views/SignInView.vue';
import TabletSignInView from '../../presentation/tablet/views/SignInView.vue';
import MobileSignInView from '../../presentation/mobile/views/SignInView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopSignInView"
        :tablet="TabletSignInView"
        :mobile="MobileSignInView"
    />
</template>
