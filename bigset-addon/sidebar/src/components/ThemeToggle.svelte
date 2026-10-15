<script lang="ts">
  import { theme, toggleTheme } from "../stores/theme.js";
</script>

<button
  class="theme-toggle"
  type="button"
  aria-label="Toggle theme"
  on:click={toggleTheme}
>
  {#if $theme === "dark"}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .theme-toggle:hover {
    background-color: rgba(0, 0, 0, 0.04);
    color: var(--foreground);
  }

  :global([data-theme="dark"]) .theme-toggle:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }
</style>
