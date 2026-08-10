<script lang="ts">
  export let status: "live" | "building" | "updating" | "failed" | "paused";
  export let label: string | undefined = undefined;

  $: text = label ?? (status === "live" ? "Live"
        : status === "building" ? "Building"
        : status === "updating" ? "Updating"
        : status === "failed" ? "Failed"
        : "Paused");
</script>

<span class="pill pill-{status}">
  <span class="pill-dot" class:pill-dot-pulse={status !== "paused" && status !== "failed"}></span>
  {text}
</span>

<style>
  /* Uses global .pill / .pill-{status} / .pill-dot classes from app.css */
</style>
