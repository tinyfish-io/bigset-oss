<script lang="ts">
  import { wizard, clearSelectedForInsert } from "../stores/wizardStore.js";
  import { api } from "../api/client.js";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";

  let inserting = false;
  let insertResult: { rowsInserted: number; startCell: string; endCell: string } | null = null;
  let insertError: string | null = null;
  let showConfirm = false;

  $: ds = $wizard.selectedForInsert?.dataset;
  $: rows = $wizard.selectedForInsert?.rows ?? [];

  function back() {
    clearSelectedForInsert();
  }

  async function insert() {
    if (!ds || inserting) return;
    inserting = true;
    insertError = null;
    showConfirm = false;
    try {
      const headers = ds.columns.map((c) => c.name);
      const result = await api.insertRows(headers, rows.map((r) => r.data), true);
      insertResult = result;
    } catch (err) {
      insertError = err instanceof Error ? err.message : "Insert failed.";
    } finally {
      inserting = false;
    }
  }
</script>

<section class="detail">
  <header class="top">
    <button class="back-btn" type="button" on:click={back}>
      <Icon name="arrow-left" size={14} />
      Back
    </button>
  </header>

  {#if !ds}
    <div class="empty">No dataset selected.</div>
  {:else}
    <div class="info">
      <div class="name-row">
        <h2 class="name">{ds.name}</h2>
        <StatusBadge status={ds.status} />
      </div>
      {#if ds.description}
        <p class="desc muted">{ds.description}</p>
      {/if}

      <div class="stats">
        <div class="stat">
          <span class="stat-num">{rows.length}</span>
          <span class="stat-label muted">rows</span>
        </div>
        <div class="stat">
          <span class="stat-num">{ds.columns.length}</span>
          <span class="stat-label muted">columns</span>
        </div>
      </div>
    </div>

    <div class="cols">
      <div class="cols-head muted">Columns</div>
      {#each ds.columns as col}
        <div class="col-row">
          <span class="col-name">{col.name}</span>
          <span class="col-type muted">{col.type}</span>
        </div>
      {/each}
    </div>

    {#if insertResult}
      <div class="alert alert-info">
        <strong>Inserted {insertResult.rowsInserted} rows</strong>
        <div class="muted small">Range {insertResult.startCell} : {insertResult.endCell}</div>
        <button class="done-btn" type="button" on:click={back}>Back to datasets</button>
      </div>
    {:else if insertError}
      <div class="alert alert-error">{insertError}</div>
    {:else if showConfirm}
      <div class="confirm-box">
        <p class="confirm-text">
          This will <strong>replace all existing data</strong> in the active sheet with {rows.length} rows.
          This cannot be undone.
        </p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" type="button" on:click={() => (showConfirm = false)} disabled={inserting}>
            Cancel
          </button>
          <button class="btn btn-danger" type="button" on:click={insert} disabled={inserting}>
            {#if inserting}
              <Spinner size="sm" />
              Inserting…
            {:else}
              Insert
            {/if}
          </button>
        </div>
      </div>
    {:else}
      <div class="actions">
        <button class="btn btn-primary" type="button" on:click={() => (showConfirm = true)}>
          <Icon name="play" size={11} />
          Insert into sheet
        </button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 14px;
    overflow-y: auto;
  }

  .top {
    display: flex;
    align-items: center;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    padding: 4px 6px;
    border-radius: 6px;
    transition: color 0.15s ease;
  }

  .back-btn:hover {
    color: var(--foreground);
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 13px;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
  }

  .name-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .name {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .desc {
    font-size: 11px;
    line-height: 1.5;
    margin: 0;
  }

  .stats {
    display: flex;
    gap: 16px;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .stat-num {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .stat-label {
    font-size: 11px;
  }

  .cols {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cols-head {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    padding: 0 4px;
    margin-bottom: 2px;
  }

  .col-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 7px;
  }

  .col-name {
    font-size: 12px;
    font-weight: 500;
    font-family: "Geist Mono", ui-monospace, monospace;
  }

  .col-type {
    font-size: 10px;
    text-transform: capitalize;
  }

  .alert {
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .alert-info {
    border: 1px solid var(--emerald-border);
    background-color: var(--emerald-soft);
    color: var(--emerald-text);
  }

  .alert-error {
    border: 1px solid var(--red-border);
    background-color: var(--red-soft);
    color: var(--red-text);
  }

  .done-btn {
    margin-top: 8px;
    background: transparent;
    border: 1px solid var(--emerald-border);
    color: var(--emerald-text);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    align-self: flex-start;
  }

  .confirm-box {
    background-color: var(--surface);
    border: 1px solid var(--red-border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .confirm-text {
    font-size: 12px;
    line-height: 1.5;
    color: var(--foreground);
    margin: 0;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
  }

  .actions {
    margin-top: auto;
    padding-top: 8px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s ease, background-color 0.15s ease;
    font-family: inherit;
    padding: 8px 16px;
    font-size: 13px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    width: 100%;
    background-color: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-secondary {
    background-color: transparent;
    color: var(--foreground);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--foreground-soft);
  }

  .btn-danger {
    background-color: var(--red-dot);
    color: white;
    border: 1px solid var(--red-dot);
    padding: 6px 14px;
    font-size: 12px;
  }

  .btn-danger:hover:not(:disabled) {
    opacity: 0.9;
  }

  .small {
    font-size: 11px;
  }
</style>
