import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dinogame/' : '/',
  plugins: [svelte()],
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    isolate: false,
    maxWorkers: 1,
  },
}))
