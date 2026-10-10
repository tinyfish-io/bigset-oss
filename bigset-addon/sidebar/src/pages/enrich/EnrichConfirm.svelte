<script lang="ts">
  import { enrichStore, eligibleCount } from "../../stores/enrichStore.js";

  $: state = $enrichStore;
  $: totalEmpty = $eligibleCount;
</script>

<section class="confirm">
  <header class="head">
    <span class="eyebrow">Confirm Enrichment</span>
    <button
      class="icon-btn"
      type="button"
      on:click={() => enrichStore.loadSelection()}
      aria-label="Re-read selection"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  </header>

  <div class="range-box">
    <span class="range-label muted small">Range</span>
    <span class="range-value">{state.range}</span>
  </div>

  <div class="stats">
    <div class="stat">
      <span class="stat-value">{state.rows.length}</span>
      <span class="stat-label">rows</span>
    </div>
    <div class="stat">
      <span class="stat-value">{state.headers.length}</span>
      <span class="stat-label">columns</span>
    </div>
    <div class="stat accent">
      <span class="stat-value">{totalEmpty}</span>
      <span class="stat-label">to fill</span>
    </div>
  </div>

  <div class="section">
    <p class="section-label muted small">Source columns</p>
    <div class="chips">
      {#each state.sourceColumns as col}
        <span class="chip chip-source">{col}</span>
      {/each}
    </div>
  </div>

  <div class="section">
    <p class="section-label muted small">Target columns</p>
    <div class="chips">
      {#each state.targetColumns as col}
        <span class="chip chip-target">{col}</span>
      {/each}
    </div>
  </div>

  {#if !state.targetColumns.length}
    <div class="alert">
      <p>All columns already have data. Nothing to enrich.</p>
    </div>
  {/if}

  <div class="actions">
    {#if state.targetColumns.length}
      <button class="btn btn-primary" type="button" on:click={() => enrichStore.enrich()}>
        Enrich {totalEmpty} Cell{totalEmpty !== 1 ? "s" : ""}
      </button>
    {/if}
    <button class="btn btn-secondary" type="button" on:click={() => enrichStore.reset()}>
      Cancel
    </button>
  </div>
</section>

<style>
  .confirm {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 14px;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--muted);
  }

  .range-box {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .range-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--foreground);
    font-family: monospace;
  }

  .stats {
    display: flex;
    gap: 8px;
  }

  .stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 14px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .stat-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--foreground);
  }

  .stat.accent .stat-value {
    color: var(--accent);
  }

  .stat-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    margin: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip {
    padding: 4px 9px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--border);
  }

  .chip-source {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
  }

  .chip-target {
    background: color-mix(in srgb, var(--warning, #f59e0b) 10%, var(--surface));
    color: var(--warning, #f59e0b);
    border-color: color-mix(in srgb, var(--warning, #f59e0b) 25%, var(--border));
  }

  .alert {
    padding: 12px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 8px;
    font-size: 13px;
    color: var(--foreground);
  }

  .alert p {
    margin: 0;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: auto;
    padding-top: 8px;
  }

  .actions .btn {
    width: 100%;
  }
</style>
