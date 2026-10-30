import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import claudeLocator from 'vite-plugin-claude-locator'

export default defineConfig({
  plugins: [svelte(), claudeLocator({ open: (process.env.CLAUDE_LOCATOR_OPEN ?? 'claude').split(',') })],
  server: { port: 5121 },
})
