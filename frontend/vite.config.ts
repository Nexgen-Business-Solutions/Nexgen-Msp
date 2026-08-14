import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import proxyOptions from './proxyOptions';

const workspaceRoot = path.resolve(__dirname, '../../..');

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 8085,
		host: '0.0.0.0',
		fs: {
			allow: [workspaceRoot],
		},
		proxy: proxyOptions,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
	build: {
		outDir: '../nexgen_msp/public/frontend',
		emptyOutDir: true,
		target: 'es2015',
	},
});
