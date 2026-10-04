<script lang="ts">
  import Header from "../components/Header.svelte";
  import { wizard } from "../stores/wizardStore.js";
  import StepDescribe from "./StepDescribe.svelte";
  import StepGenerating from "./StepGenerating.svelte";
  import StepReview from "./StepReview.svelte";
  import StepPopulating from "./StepPopulating.svelte";
  import StepDone from "./StepDone.svelte";
  import Datasets from "./Datasets.svelte";
  import Public from "./Public.svelte";
  import DatasetDetail from "./DatasetDetail.svelte";
  import EnrichTab from "./enrich/EnrichTab.svelte";

  type Tab = "generate" | "datasets" | "enrich" | "public";
  let tab: Tab = "enrich";
</script>

<div class="home">
  <Header title="BigSet" />

  {#if $wizard.selectedForInsert}
    <DatasetDetail />
  {:else}
    <nav class="tabs">
      <button
        class="tab"
        class:active={tab === "generate"}
        type="button"
        on:click={() => (tab = "generate")}
      >
        Generate
      </button>
      <button
        class="tab"
        class:active={tab === "datasets"}
        type="button"
        on:click={() => (tab = "datasets")}
      >
        My Datasets
      </button>
      <button
        class="tab"
        class:active={tab === "enrich"}
        type="button"
        on:click={() => (tab = "enrich")}
      >
        Enrich
      </button>
      <button
        class="tab"
        class:active={tab === "public"}
        type="button"
        on:click={() => (tab = "public")}
      >
        Public
      </button>
    </nav>

    <main class="content">
      {#if tab === "datasets"}
        <Datasets />
      {:else if tab === "enrich"}
        <EnrichTab />
      {:else if tab === "public"}
        <Public />
      {:else}
        {#if $wizard.step === "describe"}
          <StepDescribe />
        {:else if $wizard.step === "generating"}
          <StepGenerating />
        {:else if $wizard.step === "review"}
          <StepReview />
        {:else if $wizard.step === "populating"}
          <StepPopulating />
        {:else if $wizard.step === "done"}
          <StepDone />
        {/if}
      {/if}
    </main>
  {/if}
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--background);
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    background-color: var(--surface);
    flex-shrink: 0;
  }

  .tab {
    flex: 1;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .tab:hover {
    color: var(--foreground-soft);
  }

  .tab.active {
    color: var(--foreground);
    border-bottom-color: var(--accent);
  }

  .content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
