<script lang="ts">
  import { onMount } from "svelte";
  import { api, type DatasetSummary } from "../api/client.js";
  import { setSelectedForInsert } from "../stores/wizardStore.js";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";

  let datasets: DatasetSummary[] = [];
  let loading = true;
  let loadError: string | null = null;
  let previewingId: string | null = null;

  async function load() {
    loading = true;
    loadError = null;
    try {
      datasets = await api.listDatasets();
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load datasets.";
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function selectDataset(ds: DatasetSummary) {
    if (previewingId) return;
    previewingId = ds.id;
    try {
      const { rows } = await api.listRows(ds.id);
      setSelectedForInsert(ds, rows);
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Failed to load rows.";
    } finally {
      previewingId = null;
    }
  }
</script>

<section class="datasets">
  <header class="head">
    <span class="eyebrow">Your datasets</span>
    <button class="icon-btn" type="button" on:click={load} disabled={loading} aria-label="Refresh">
      <Icon name="refresh" size={12} />
    </button>
  </header>

  {#if loading}
    <div class="center">
      <Spinner size="md" />
    </div>
  {:else if loadError}
    <div class="alert alert-error">{loadError}</div>
  {:else if datasets.length === 0}
    <div class="empty">
      <p class="muted">No datasets yet.</p>
      <p class="muted small">Generate one from the Generate tab.</p>
    </div>
  {:else}
    <div class="list">
      {#each datasets as ds (ds.id)}
        <button
          class="card"
          type="button"
          on:click={() => selectDataset(ds)}
          disabled={previewingId !== null}
        >
          <div class="card-top">
            <span class="card-name">{ds.name}</span>
            <StatusBadge status={ds.status} />
          </div>
          {#if ds.description}
            <p class="card-desc muted">{ds.description}</p>
          {/if}
          <div class="card-foot">
            <span class="muted small">{ds.rowCount} rows</span>
            <span class="muted small">{ds.columns.length} cols</span>
            {#if previewingId === ds.id}
              <Spinner size="sm" />
            {:else}
              <Icon name="play" size={11} />
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .datasets {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 12px;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .card:hover:not(:disabled) {
    border-color: var(--foreground-ghost);
    background-color: var(--surface-2);
  }

  .card:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-desc {
    font-size: 11px;
    line-height: 1.4;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .small {
    font-size: 11px;
  }
</style>
