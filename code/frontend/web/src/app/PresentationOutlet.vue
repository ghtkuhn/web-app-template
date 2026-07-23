<script setup lang="ts">
import { computed, type Component } from 'vue';
import { usePresentation } from './presentation.ts';

const props = defineProps<{
    desktop: Component;
    tablet: Component;
    mobile: Component;
}>();

const presentation = usePresentation();
const activeComponent = computed(() => props[presentation.value]);
</script>

<template>
    <component :is="activeComponent">
        <slot />
    </component>
</template>
