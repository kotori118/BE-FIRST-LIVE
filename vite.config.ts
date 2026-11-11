import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{outDir:'app',emptyOutDir:true,rollupOptions:{input:'app-entry.html'}}});
