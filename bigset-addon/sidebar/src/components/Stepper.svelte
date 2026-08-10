<script lang="ts">
  export let current: number; // 1-based
  export let total: number;
  export let labels: string[] = [];
</script>

<div class="stepper">
  {#each Array.from({ length: total }, (_, i) => i + 1) as step}
    {@const isDone = step < current}
    {@const isCurrent = step === current}
    <div class="step">
      <div
        class="step-dot"
        class:done={isDone}
        class:current={isCurrent}
      >
        {#if isDone}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {:else}
          {step}
        {/if}
      </div>
      {#if step < total}
        <div class="step-line" class:done={isDone}></div>
      {/if}
    </div>
  {/each}
  {#if labels.length}
    <div class="step-labels">
      {#each labels as label, i}
        <span class="step-label" class:active={i + 1 === current}>
          {label}
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stepper {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .step-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background-color: var(--background);
    border: 1px solid var(--border);
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .step-dot.done {
    background-color: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .step-dot.current {
    border-color: var(--foreground);
    color: var(--foreground);
  }

  .step-line {
    flex: 1;
    height: 1px;
    background-color: var(--border);
    margin: 0 6px;
    transition: background-color 0.2s ease;
  }

  .step-line.done {
    background-color: var(--accent);
  }

  .step-labels {
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
  }

  .step-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    font-weight: 600;
    flex: 1;
    text-align: center;
  }

  .step-label.active {
    color: var(--foreground);
  }
</style>
