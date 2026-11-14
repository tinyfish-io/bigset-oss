<script lang="ts">
  import Spinner from "../components/Spinner.svelte";
  import { wizard } from "../stores/wizardStore.js";
</script>

<section class="generating">
  <div class="center">
    <Spinner size="lg" />
    <h3>Analyzing your request…</h3>
    <p class="muted">Figuring out what columns and data sources to use</p>
  </div>
  {#if $wizard.prompt}
    <div class="prompt-quote">
      <span class="eyebrow">Your prompt</span>
      <p>“{$wizard.prompt.trim()}”</p>
    </div>
  {/if}
</section>

<style>
  .generating {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    text-align: center;
    gap: 24px;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .center h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .center p {
    margin: 0;
    font-size: 12px;
  }

  .prompt-quote {
    max-width: 280px;
    width: 100%;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .prompt-quote p {
    font-size: 11px;
    color: var(--foreground-soft);
    margin: 0;
    line-height: 1.5;
    font-style: italic;
    word-break: break-word;
  }
</style>
