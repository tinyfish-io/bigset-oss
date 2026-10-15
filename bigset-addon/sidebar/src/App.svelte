<script lang="ts">
  import Router from "svelte-spa-router";
  import Home from "./pages/Home.svelte";
  import Settings from "./pages/Settings.svelte";
</script>

<Router
  routes={{
    "/": Home,
    "/settings": Settings,
  }}
/>

<style>
  /* App-level layout */
  :global(html), :global(body) {
    height: 100%;
  }
  :global(#app) {
    height: 100%;
  }
</style>
