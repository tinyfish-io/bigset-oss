<script lang="ts">
  import {
    wizard,
    updateSchema,
    updateColumn,
    removeColumn,
    addColumn,
    setStep,
    setDataset,
    setError,
    setPopulating,
    type ColumnType,
  } from "../stores/wizardStore.js";
  import { api } from "../api/client.js";
  import ColumnIcon from "../components/ColumnIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";

  let creating = false;
  let localError: string | null = null;

  const columnTypes: Array<{ value: ColumnType; label: string }> = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
    { value: "url", label: "URL" },
    { value: "date", label: "Date" },
  ];

  async function createAndPopulate() {
    if (!$wizard.schema || creating) return;
    creating = true;
    localError = null;
    setError(null);

    try {
      const schema = $wizard.schema;

      // Validate
      if (!schema.name.trim()) throw new Error("Dataset name is required.");
      if (schema.columns.length === 0) throw new Error("Add at least one column.");
      for (const c of schema.columns) {
        if (!c.name.trim()) throw new Error("All columns need a name.");
      }

      const dataset = await api.createDataset({
        name: schema.name.trim(),
        description: schema.description.trim() || $wizard.prompt.trim(),
        columns: schema.columns.map((c) => ({
          name: c.name.trim(),
          type: c.type,
          description: c.description.trim() || undefined,
          isPrimaryKey: c.isPrimaryKey || undefined,
        })),
        retrievalStrategy: schema.retrievalStrategy ?? undefined,
        sourceHint: schema.sourceHint ?? undefined,
        maxRowCount: schema.maxRowCount,
        refreshCadence: "manual",
      });

      setDataset({
        id: dataset.id,
        name: dataset.name,
        status: dataset.status,
        rowCount: dataset.rowCount,
        columns: dataset.columns,
      });

      // Kick off populate
      try {
        await api.populate(
          dataset.id,
          schema.name.trim(),
          schema.description.trim() || $wizard.prompt.trim(),
          schema.maxRowCount,
          schema.columns.map((c) => ({
            name: c.name.trim(),
            type: c.type,
            description: c.description.trim() || undefined,
            isPrimaryKey: c.isPrimaryKey || undefined,
          })),
        );
      } catch (err) {
        // Populate can take a while; we move to the populating view regardless
        // and let the polling figure out the truth.
        console.warn("populate kickoff error", err);
      }
      setPopulating();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create dataset.";
      localError = msg;
      setError(msg);
    } finally {
      creating = false;
    }
  }

  function handleTypeChange(index: number, value: string) {
    updateColumn(index, { type: value as ColumnType });
  }

  function handleNameChange(index: number, value: string) {
    updateColumn(index, { name: value });
    // Update primaryKey reference if needed
    const col = $wizard.schema?.columns[index];
    if (col?.isPrimaryKey) {
      updateSchema({ primaryKey: value || null });
    }
  }

  function togglePrimaryKey(index: number) {
    const col = $wizard.schema?.columns[index];
    if (!col) return;
    const newPk = !col.isPrimaryKey;
    // Only allow one PK
    if (newPk) {
      $wizard.schema?.columns.forEach((_, i) => {
        if (i !== index) updateColumn(i, { isPrimaryKey: false });
      });
    }
    updateColumn(index, { isPrimaryKey: newPk });
    updateSchema({ primaryKey: newPk ? col.name || null : null });
  }
</script>

{#if $wizard.schema}
  <section class="review">
    <div class="scroll-area">
      <header class="step-header">
        <span class="eyebrow">Review schema</span>
        <h2>{$wizard.schema.columns.length} column{$wizard.schema.columns.length === 1 ? "" : "s"}</h2>
      </header>

      {#if localError}
        <div class="alert alert-error">{localError}</div>
      {/if}

      <div class="field-group">
        <label class="label" for="dataset-name">Dataset name</label>
        <input
          id="dataset-name"
          class="input"
          type="text"
          bind:value={$wizard.schema.name}
          placeholder="My dataset"
        />
      </div>

      <div class="field-group">
        <label class="label" for="dataset-desc">Description</label>
        <textarea
          id="dataset-desc"
          class="textarea"
          rows="2"
          bind:value={$wizard.schema.description}
          placeholder="What is this dataset for?"
        ></textarea>
      </div>

      <div class="field-group row">
        <div class="col">
          <label class="label" for="max-rows">Max rows</label>
          <input
            id="max-rows"
            class="input"
            type="number"
            min="1"
            max="2500"
            bind:value={$wizard.schema.maxRowCount}
          />
        </div>
        <div class="col">
          <label class="label">Strategy</label>
          <div class="readonly muted small">
            {$wizard.schema.retrievalStrategy ?? "auto"}
          </div>
        </div>
      </div>

      <div class="columns-header">
        <span class="eyebrow">Columns ({$wizard.schema.columns.length})</span>
        <button class="btn btn-ghost add-col" type="button" on:click={addColumn}>
          <Icon name="plus" size={11} />
          Add column
        </button>
      </div>

      <div class="columns">
        {#each $wizard.schema.columns as col, i (i)}
          <div class="col-row">
            <button
              class="pk-toggle"
              class:active={col.isPrimaryKey}
              type="button"
              on:click={() => togglePrimaryKey(i)}
              aria-label={col.isPrimaryKey ? "Remove as primary key" : "Set as primary key"}
              title={col.isPrimaryKey ? "Primary key" : "Set as primary key"}
            >
              <ColumnIcon type={col.type} />
            </button>
            <select
              class="select type-select"
              value={col.type}
              on:change={(e) => handleTypeChange(i, e.currentTarget.value)}
            >
              {#each columnTypes as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
            <input
              class="input name-input"
              type="text"
              value={col.name}
              on:input={(e) => handleNameChange(i, e.currentTarget.value)}
              placeholder="column_name"
            />
            <button
              class="icon-btn remove"
              type="button"
              aria-label="Remove column"
              on:click={() => removeColumn(i)}
            >
              <Icon name="trash" size={12} />
            </button>
            {#if col.description}
              <textarea
                class="textarea desc-input"
                rows={Math.min(Math.max(col.description.split("\n").length, 1), 5)}
                value={col.description}
                on:input={(e) => updateColumn(i, { description: e.currentTarget.value })}
                placeholder="Optional description"
              ></textarea>
            {/if}
          </div>
        {/each}
      </div>

      {#if $wizard.schema.primaryKey}
        <div class="pk-banner">
          <StatusBadge status="live" label="Primary key: {$wizard.schema.primaryKey}" />
        </div>
      {/if}
    </div>

    <footer class="footer">
      <button class="btn btn-secondary" type="button" on:click={() => setStep("describe")} disabled={creating}>
        Back
      </button>
      <button class="btn btn-primary" type="button" on:click={createAndPopulate} disabled={creating}>
        {#if creating}
          <Spinner size="sm" />
          Creating…
        {:else}
          <Icon name="play" size={11} />
          Create &amp; populate
        {/if}
      </button>
    </footer>
  </section>
{/if}

<style>
  .review {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .step-header h2 {
    margin: 4px 0 0;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-group.row {
    flex-direction: row;
    gap: 10px;
  }

  .field-group.row .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .readonly {
    padding: 8px 12px;
    border-radius: 8px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    font-size: 12px;
    text-transform: capitalize;
  }

  .small {
    font-size: 11px;
  }

  .columns-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
  }

  .add-col {
    padding: 4px 8px;
    font-size: 11px;
  }

  .columns {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .col-row {
    display: grid;
    grid-template-columns: 28px 88px 1fr 24px;
    grid-template-rows: auto auto;
    grid-template-areas:
      "pk type name remove"
      "desc desc desc desc";
    gap: 4px 6px;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 8px 8px 8px;
    align-items: center;
  }

  .col-row:focus-within {
    border-color: var(--foreground-ghost);
  }

  .pk-toggle {
    grid-area: pk;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background-color: var(--background);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pk-toggle:hover {
    border-color: var(--amber-border);
  }

  .pk-toggle.active {
    background-color: rgba(217, 119, 6, 0.08);
    border-color: var(--amber-border);
  }

  .type-select {
    grid-area: type;
    font-size: 11px;
    padding: 4px 22px 4px 6px;
    height: 28px;
  }

  .name-input {
    grid-area: name;
    font-size: 12px;
    padding: 4px 8px;
    height: 28px;
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .remove {
    grid-area: remove;
    color: var(--muted);
  }

  .remove:hover {
    color: var(--red-text);
    background-color: var(--red-soft);
  }

  .desc-input {
    grid-area: desc;
    font-size: 11px;
    padding: 4px 8px;
    line-height: 1.4;
    background-color: var(--background);
    border-color: var(--border);
    resize: vertical;
    max-height: 160px;
    overflow-y: auto;
  }

  .pk-banner {
    display: flex;
    justify-content: flex-start;
  }

  .footer {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding: 12px;
    background-color: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .footer .btn-primary {
    margin-left: auto;
  }
</style>
