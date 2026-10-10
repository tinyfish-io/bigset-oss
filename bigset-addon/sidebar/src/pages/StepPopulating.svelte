<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    wizard,
    setDataset,
    setRowCount,
    setError,
    setStep,
    setRows,
  } from "../stores/wizardStore.js";
  import { api } from "../api/client.js";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Spinner from "../components/Spinner.svelte";
  import Icon from "../components/Icon.svelte";

  let pollHandle: number | null = null;
  let stopping = false;
  let elapsedSec = 0;
  let tickHandle: number | null = null;

  function fmtElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }

  async function pollOnce() {
    const id = $wizard.dataset?.id;
    if (!id) return;
    try {
      const { dataset, rows } = await api.listRows(id);
      setDataset({
        id: dataset.id,
        name: dataset.name,
        status: dataset.status,
        rowCount: dataset.rowCount ?? rows.length,
        columns: dataset.columns,
        description: dataset.description,
        lastStatusError: dataset.lastStatusError,
      });
      setRowCount(rows.length);
      setRows(rows.map((r) => r.data));

      if (dataset.status === "live") {
        setStep("done");
        stopPolling();
      } else if (dataset.status === "failed") {
        const errMsg = dataset.lastStatusError ?? "";
        if (errMsg.includes("stopped") || errMsg.includes("interrupted") || errMsg.includes("aborted")) {
          setStep("done");
        } else {
          setError(errMsg || "Population failed.");
          setStep("describe");
        }
        stopPolling();
      }
    } catch (err) {
      console.warn("poll error", err);
    }
  }

  function startPolling() {
    if (pollHandle !== null) return;
    pollHandle = window.setInterval(pollOnce, 2500);
    void pollOnce();
    tickHandle = window.setInterval(() => {
      if ($wizard.startedAt) {
        elapsedSec = Math.floor((Date.now() - $wizard.startedAt) / 1000);
      }
    }, 1000);
  }

  function stopPolling() {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  async function stop() {
    if (stopping || !$wizard.dataset) return;
    stopping = true;
    stopPolling();
    try {
      await api.stopDataset($wizard.dataset.id);
      const { rows } = await api.listRows($wizard.dataset.id);
      setRows(rows.map((r) => r.data));
      setRowCount(rows.length);
      setStep("done");
    } catch (err) {
      console.warn("stop error", err);
    } finally {
      stopping = false;
    }
  }

  onMount(() => {
    if (!$wizard.dataset) {
      setStep("describe");
      return;
    }
    if ($wizard.dataset.status === "live") {
      setStep("done");
      return;
    }
    startPolling();
  });

  onDestroy(() => {
    stopPolling();
  });
</script>

<section class="populating">
  <div class="status-row">
    <StatusBadge status={$wizard.dataset?.status ?? "building"} />
    <span class="muted small">{fmtElapsed(elapsedSec)}</span>
  </div>

  <div class="progress-card">
    <div class="big-row">
      <span class="big-num">{$wizard.rowCount}</span>
      <span class="big-label">rows collected</span>
    </div>
    <div class="target">
      target: {$wizard.schema?.maxRowCount ?? 100}
    </div>

    <div class="bar">
      <div
        class="bar-fill"
        style:width="{Math.min(100, ($wizard.rowCount / ($wizard.schema?.maxRowCount ?? 100)) * 100)}%"
      ></div>
    </div>

    <div class="phase">
      <Spinner size="sm" />
      <span>
        {#if $wizard.dataset?.status === "building"}
          Searching the web and inserting rows…
        {:else if $wizard.dataset?.status === "updating"}
          Refreshing rows…
        {:else}
          Working…
        {/if}
      </span>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-danger" type="button" on:click={stop} disabled={stopping}>
      <Icon name="stop" size={11} />
      Stop
    </button>
  </div>

  <div class="hint muted small">
    Tip: keep this sidebar open. Rows appear in your Sheet when population completes.
  </div>
</section>

<style>
  .populating {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 16px;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .small {
    font-size: 11px;
  }

  .progress-card {
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .big-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .big-num {
    font-size: 32px;
    font-weight: 700;
    color: var(--foreground);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .big-label {
    font-size: 13px;
    color: var(--muted);
  }

  .target {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    margin-top: -4px;
  }

  .bar {
    height: 6px;
    background-color: var(--background);
    border-radius: 3px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background-color: var(--accent);
    border-radius: 3px;
    transition: width 0.5s ease;
  }

  .phase {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--foreground-soft);
    margin-top: 4px;
  }

  .actions {
    display: flex;
    justify-content: center;
  }

  .hint {
    margin-top: auto;
    text-align: center;
    line-height: 1.5;
  }
</style>
