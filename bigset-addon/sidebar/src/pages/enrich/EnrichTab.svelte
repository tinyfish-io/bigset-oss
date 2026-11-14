<script lang="ts">
  import { enrichStore } from "../../stores/enrichStore.js";
  import EnrichConfirm from "./EnrichConfirm.svelte";
  import EnrichDone from "./EnrichDone.svelte";
  import Spinner from "../../components/Spinner.svelte";

  $: status = $enrichStore.status;
  $: error = $enrichStore.error;
</script>

<div class="tab">
  {#if status === "idle"}
    <div class="prompt">
      <div class="prompt-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      </div>
      <p class="prompt-title">Select cells to enrich</p>
      <p class="prompt-desc muted">
        Highlight a range in your sheet <strong>including the header row</strong>, then click below.
      </p>
      <button class="btn btn-primary" type="button" on:click={() => enrichStore.loadSelection()}>
        Read Selection
      </button>
    </div>
  {:else if status === "loading"}
    <div class="center">
      <Spinner size="lg" />
      <p class="muted">Reading selection…</p>
    </div>
  {:else if status === "confirm"}
    <EnrichConfirm />
  {:else if status === "enriching"}
    <div class="center">
      <Spinner size="lg" />
      <p class="muted">Researching and filling cells…</p>
      <p class="muted small">This may take a minute for larger selections.</p>
    </div>
  {:else if status === "done"}
    <EnrichDone />
  {:else if status === "error"}
    <div class="error-box">
      <div class="error-icon">!</div>
      <p class="error-title">Something went wrong</p>
      <p class="error-msg">{error}</p>
      <p class="error-hint muted small">Select a range in your sheet (including header row), then try again.</p>
      <button class="btn btn-secondary" type="button" on:click={() => enrichStore.loadSelection()}>
        Try Again
      </button>
    </div>
  {/if}
</div>

<style>
  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .prompt {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 32px 24px;
    text-align: center;
  }

  .prompt-icon {
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .prompt-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--foreground);
    margin: 0;
  }

  .prompt-desc {
    font-size: 13px;
    line-height: 1.6;
    margin: 0 0 8px 0;
    max-width: 260px;
  }

  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
  }

  .center p {
    margin: 0;
    font-size: 14px;
  }

  .center .small {
    font-size: 12px;
  }

  .error-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }

  .error-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--error, #ef4444) 15%, transparent);
    color: var(--error, #ef4444);
    font-size: 22px;
    font-weight: 700;
  }

  .error-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--foreground);
    margin: 0;
  }

  .error-msg {
    font-size: 13px;
    color: var(--muted);
    margin: 0;
    max-width: 280px;
    line-height: 1.5;
  }

  .error-hint {
    margin: 0;
    max-width: 280px;
  }
</style>
