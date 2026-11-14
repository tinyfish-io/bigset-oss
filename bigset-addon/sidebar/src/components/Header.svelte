<script lang="ts">
  import { push } from "svelte-spa-router";
  import ThemeToggle from "./ThemeToggle.svelte";
  import Icon from "./Icon.svelte";

  export let title: string = "BigSet";
  export let showBack: boolean = false;
  export let onBack: (() => void) | null = null;
</script>

<header>
  {#if showBack}
    <button class="back-btn" type="button" aria-label="Back" on:click={onBack ?? (() => push("/"))}>
      <Icon name="arrow-left" size={14} />
    </button>
  {/if}
  <div class="title-block">
    <div class="brand-mark" aria-hidden="true">
      <span class="dot dot-r"></span>
      <span class="dot dot-y"></span>
      <span class="dot dot-g"></span>
      <span class="dot dot-b"></span>
    </div>
    <span class="title">{title}</span>
  </div>
  <div class="actions">
    <ThemeToggle />
    <button
      class="icon-btn"
      type="button"
      aria-label="Settings"
      on:click={() => push("/settings")}
    >
      <Icon name="settings" size={14} />
    </button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 44px;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .back-btn:hover {
    background-color: rgba(0, 0, 0, 0.04);
    color: var(--foreground);
  }

  :global([data-theme="dark"]) .back-btn:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }

  .title-block {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .dot {
    width: 4px;
    height: 12px;
    border-radius: 1px;
    display: inline-block;
  }

  .dot-r { background: #ea4335; }
  .dot-y { background: #fbbc04; }
  .dot-g { background: #34a853; }
  .dot-b { background: #4285f4; }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--foreground);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
</style>
