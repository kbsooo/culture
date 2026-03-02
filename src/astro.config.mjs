// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://kbsoo.github.io',
  base: '/culture',
  integrations: [tailwind({ applyBaseStyles: false })],
  output: 'static',
});
