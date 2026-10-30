<script>
  import Panel from './Panel.svelte'
  import Counter from './Counter.svelte'

  export let title = 'claude-locator · Svelte 4'
</script>

<main style="font-family: system-ui; padding: 24px">
  <h1>{title}</h1>
  <p>Hold Option (Alt) and click anything to open its source. Option+right-click shows the available source tree.</p>
  <Panel>
    <Counter />
  </Panel>
</main>
