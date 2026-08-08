<script setup lang="ts">
import DesktopSignUpView from '../../presentation/desktop/views/SignUpView.vue';
import TabletSignUpView from '../../presentation/tablet/views/SignUpView.vue';
import MobileSignUpView from '../../presentation/mobile/views/SignUpView.vue';
import PresentationOutlet from '../PresentationOutlet.vue';
</script>

<template>
    <PresentationOutlet
        :desktop="DesktopSignUpView"
        :tablet="TabletSignUpView"
        :mobile="MobileSignUpView"
    />
</template>
