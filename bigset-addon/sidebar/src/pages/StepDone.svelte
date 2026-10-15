<script lang="ts">
  import { onMount } from "svelte";
  import {
    wizard,
    setStep,
    setRows,
    setRowCount,
    setError,
    resetWizard,
  } from "../stores/wizardStore.js";
  import { api } from "../api/client.js";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";

  let inserting = false;
  let insertResult: { rowsInserted: number; startCell: string; endCell: string } | null = null;
  let localError: string | null = null;

  // Always (re)load the rows when this view mounts, so even if the user
  // navigated away during populate, the latest snapshot is available.
  onMount(async () => {
    if ($wizard.dataset && $wizard.rows.length === 0) {
      try {
        const { rows, dataset } = await api.listRows($wizard.dataset.id);
        setRows(rows.map((r) => r.data));
        setRowCount(dataset.rowCount ?? rows.length);
        $wizard.dataset.rowCount = dataset.rowCount ?? rows.length;
        $wizard.dataset.columns = dataset.columns;
      } catch (err) {
        console.warn("reload rows error", err);
      }
    }
  });

  async function insertIntoSheet() {
    if (!$wizard.dataset || inserting) return;
    inserting = true;
    localError = null;
    try {
      const headers = $wizard.dataset.columns.map((c) => c.name);
      const result = await api.insertRows(headers, $wizard.rows, true);
      insertResult = result;
      // Reset back to home after a brief moment so the user sees confirmation.
      setTimeout(() => resetWizard(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Insert failed.";
      localError = msg;
    } finally {
      inserting = false;
    }
  }

  function startNew() {
    resetWizard();
  }

  function backToPopulate() {
    setStep("populating");
  }
</script>

<section class="done">
  <div class="status-row">
    <StatusBadge status="live" label="Live" />
  </div>

  <div class="summary-card">
    <div class="check-circle">
      <Icon name="check" size={20} />
    </div>
    <h2>Dataset is live</h2>
    <p class="muted">
      <strong>{$wizard.rowCount}</strong> row{$wizard.rowCount === 1 ? "" : "s"} ready to insert into
      <strong>{$wizard.dataset?.name ?? "your sheet"}</strong>
    </p>
  </div>

  {#if insertResult}
    <div class="alert alert-info">
      <strong>Inserted {insertResult.rowsInserted} rows</strong>
      <div class="muted small">Range {insertResult.startCell} : {insertResult.endCell}</div>
    </div>
  {:else if localError}
    <div class="alert alert-error">{localError}</div>
  {/if}

  <div class="actions">
    <button class="btn btn-primary" type="button" on:click={insertIntoSheet} disabled={inserting}>
      {#if inserting}
        <Spinner size="sm" />
        Inserting…
      {:else}
        <Icon name="play" size={11} />
        Insert into sheet
      {/if}
    </button>
    <button class="btn btn-secondary" type="button" on:click={startNew}>
      <Icon name="plus" size={11} />
      New dataset
    </button>
  </div>

  <div class="footer-actions">
    <button class="link-btn" type="button" on:click={backToPopulate}>
      <Icon name="arrow-left" size={11} />
      Back to status
    </button>
  </div>
</section>

<style>
  .done {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 16px;
  }

  .status-row {
    display: flex;
  }

  .summary-card {
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }

  .summary-card h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .summary-card p {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  .check-circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: var(--emerald-soft);
    border: 1px solid var(--emerald-border);
    color: var(--emerald-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .footer-actions {
    margin-top: auto;
    display: flex;
    justify-content: center;
  }

  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    padding: 4px 6px;
    border-radius: 6px;
    transition: color 0.15s ease;
  }

  .link-btn:hover {
    color: var(--foreground);
  }

  .small {
    font-size: 11px;
  }
</style>
