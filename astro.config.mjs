// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwind from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	output: 'static',
	adapter: vercel(),
	integrations: [react()],
	vite: {
		plugins: [tailwind()]
	}
});