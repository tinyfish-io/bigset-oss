<script lang="ts">
  import { enrichStore } from "../../stores/enrichStore.js";

  $: state = $enrichStore;

  $: filledResults = state.results.filter((r) => !r.error && Object.keys(r.values).length > 0);
  $: errorResults = state.results.filter((r) => r.error);
  $: skippedResults = state.results.filter((r) => !r.error && Object.keys(r.values).length === 0);

  function reset() {
    enrichStore.reset();
    enrichStore.loadSelection();
  }
</script>

<section class="done">
  <div class="success-banner">
    <div class="check-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </div>
    <span class="banner-text">Enrichment Complete</span>
  </div>

  <div class="stats">
    <div class="stat stat-success">
      <span class="stat-value">{filledResults.length}</span>
      <span class="stat-label">rows filled</span>
    </div>
    {#if errorResults.length > 0}
      <div class="stat stat-error">
        <span class="stat-value">{errorResults.length}</span>
        <span class="stat-label">errors</span>
      </div>
    {/if}
    {#if skippedResults.length > 0}
      <div class="stat">
        <span class="stat-value">{skippedResults.length}</span>
        <span class="stat-label">no data</span>
      </div>
    {/if}
  </div>

  {#if filledResults.length > 0}
    <div class="detail-list">
      <p class="list-label muted small">Filled cells</p>
      {#each filledResults as r}
        <div class="detail-row">
          {#each Object.entries(r.values) as [col, val]}
            <div class="cell-pair">
              <span class="cell-col">{col}</span>
              <span class="cell-val">{String(val)}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  {#if errorResults.length > 0}
    <div class="detail-list">
      <p class="list-label muted small">Errors</p>
      {#each errorResults as r}
        <div class="detail-row error-row">
          <span class="cell-col">Row {r.rowIndex}</span>
          <span class="cell-val">{r.error}</span>
        </div>
      {/each}
    </div>
  {/if}

  <p class="hint muted">Written directly to your sheet. Only empty cells were filled — existing data was never overwritten.</p>

  <div class="actions">
    <button class="btn btn-primary" type="button" on:click={reset}>
      Enrich Another Range
    </button>
    <button class="btn btn-secondary" type="button" on:click={() => enrichStore.reset()}>
      Done
    </button>
  </div>
</section>

<style>
  .done {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 14px;
    overflow-y: auto;
  }

  .success-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--success, #22c55e) 30%, transparent);
    border-radius: 10px;
  }

  .check-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--success, #22c55e);
    color: white;
    flex-shrink: 0;
  }

  .banner-text {
    font-size: 15px;
    font-weight: 600;
    color: var(--foreground);
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

  .stat-success .stat-value {
    color: var(--success, #22c55e);
  }

  .stat-error .stat-value {
    color: var(--error, #ef4444);
  }

  .stat-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }

  .detail-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .list-label {
    margin: 0;
  }

  .detail-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .error-row {
    background: color-mix(in srgb, var(--error, #ef4444) 8%, var(--surface));
    border-color: color-mix(in srgb, var(--error, #ef4444) 20%, var(--border));
  }

  .cell-pair {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .cell-col {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--muted);
  }

  .cell-val {
    font-size: 12px;
    font-weight: 500;
    color: var(--foreground);
    word-break: break-word;
  }

  .hint {
    font-size: 12px;
    line-height: 1.5;
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
