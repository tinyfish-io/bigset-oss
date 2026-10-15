<script lang="ts">
  export let size: "sm" | "md" | "lg" = "md";
</script>

<div class="spinner" class:spinner-lg={size === "lg"} role="status" aria-label="Loading"></div>

<style>
  /* Uses global .spinner / .spinner-lg from app.css */
</style>
