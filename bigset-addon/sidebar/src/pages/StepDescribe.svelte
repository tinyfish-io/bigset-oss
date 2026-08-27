<script lang="ts">
  import { wizard, setPrompt, setStep, setError, setSchema, type SchemaDraft } from "../stores/wizardStore.js";
  import { api } from "../api/client.js";
  import { snakeToTitleCase } from "../lib/format.js";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";

  let generating = false;
  let localError: string | null = null;

  function toSchemaType(t: string): SchemaDraft["columns"][number]["type"] {
    if (t === "number" || t === "boolean" || t === "url" || t === "date") return t;
    return "text";
  }

  async function generateSchema() {
    if (!$wizard.prompt.trim() || generating) return;
    generating = true;
    localError = null;
    setError(null);
    setStep("generating");
    try {
      const schema = await api.inferSchema($wizard.prompt.trim());
      const draft: SchemaDraft = {
        name: snakeToTitleCase(schema.dataset_name || ""),
        description: schema.description || $wizard.prompt.trim(),
        primaryKey: schema.primary_key ?? null,
        retrievalStrategy: schema.retrieval_strategy ?? null,
        sourceHint: schema.source_hint ?? null,
        maxRowCount: 100,
        columns: (schema.columns ?? []).map((c) => ({
          name: c.display_name,
          type: toSchemaType(c.type),
          description: c.retrieval_hint ?? "",
          isPrimaryKey: Boolean(c.is_primary_key),
        })),
      };
      // If the schema didn't declare a primary_key, infer it from the first PK column
      if (!draft.primaryKey) {
        const pkCol = draft.columns.find((c) => c.isPrimaryKey);
        draft.primaryKey = pkCol?.name ?? null;
      }
      setSchema(draft);
      setStep("review");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Schema generation failed";
      localError = message;
      setError(message);
      setStep("describe");
    } finally {
      generating = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generateSchema();
    }
  }
</script>

<section class="step1">
  <header class="step1-header">
    <span class="eyebrow">Datasets</span>
    <h2>What do you want to track?</h2>
    <p class="muted">Describe the data and BigSet will design the columns and sources for you.</p>
  </header>

  <div class="prompt-wrap">
    <textarea
      class="textarea prompt"
      rows="5"
      placeholder="e.g. YC companies that are currently hiring engineers"
      bind:value={$wizard.prompt}
      on:keydown={onKeydown}
      disabled={generating}
    ></textarea>
    <div class="hint-row">
      <span class="hint">⌘ + Enter to generate</span>
    </div>
  </div>

  {#if localError}
    <div class="alert alert-error">
      <strong>Couldn't generate schema.</strong>
      <div class="error-msg">{localError}</div>
    </div>
  {/if}

  <div class="actions">
    <button class="btn btn-primary" on:click={generateSchema} disabled={!$wizard.prompt.trim() || generating}>
      {#if generating}
        <Spinner size="sm" />
        Generating…
      {:else}
        <Icon name="sparkle" size={12} />
        Generate schema
      {/if}
    </button>
  </div>

  <div class="examples">
    <div class="eyebrow small">Try a prompt</div>
    <button class="example" type="button" on:click={() => setPrompt("Series A SaaS startups that launched in 2024 with AI features")}>
      Series A SaaS startups that launched in 2024 with AI features
    </button>
    <button class="example" type="button" on:click={() => setPrompt("NHL teams and their current head coaches")}>
      NHL teams and their current head coaches
    </button>
    <button class="example" type="button" on:click={() => setPrompt("Top indie hacker projects that launched on Product Hunt in Q1 2025")}>
      Top indie hacker projects that launched on Product Hunt in Q1 2025
    </button>
  </div>
</section>

<style>
  .step1 {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px;
    flex: 1;
    overflow-y: auto;
  }

  .step1-header h2 {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 4px 0 4px;
    line-height: 1.2;
  }

  .step1-header p {
    font-size: 12px;
    margin: 0;
    line-height: 1.5;
  }

  .prompt-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prompt {
    font-size: 13px;
    line-height: 1.5;
    min-height: 96px;
  }

  .hint-row {
    display: flex;
    justify-content: flex-end;
  }

  .hint {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .examples {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .eyebrow.small {
    font-size: 10px;
    margin-bottom: 2px;
  }

  .example {
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--foreground-soft);
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
    line-height: 1.4;
  }

  .example:hover {
    border-style: solid;
    border-color: var(--foreground-ghost);
    color: var(--foreground);
    background-color: var(--surface);
  }

  .error-msg {
    margin-top: 4px;
    opacity: 0.85;
  }
</style>
