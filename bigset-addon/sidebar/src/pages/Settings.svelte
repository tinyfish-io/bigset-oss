<script lang="ts">
  import { onMount } from "svelte";
  import { push } from "svelte-spa-router";
  import Header from "../components/Header.svelte";
  import { api } from "../api/client.js";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";

  let backendUrl = "";
  let apiKey = "";
  let savedBackendUrl = "";
  let savedApiKey = "";
  let loading = true;
  let saving = false;
  let testing = false;
  let testResult: { ok: boolean; message: string } | null = null;
  let showKey = false;

  onMount(async () => {
    try {
      savedBackendUrl = await api.getBackendUrl();
      savedApiKey = await api.getApiKey();
      backendUrl = savedBackendUrl;
      // Only show the last 4 chars of the API key for security
      apiKey = savedApiKey ? savedApiKey : "";
    } catch (err) {
      console.warn("settings load error", err);
    } finally {
      loading = false;
    }
  });

  async function save() {
    if (saving) return;
    saving = true;
    try {
      await api.setBackendUrl(backendUrl.trim());
      await api.setApiKey(apiKey.trim());
      savedBackendUrl = backendUrl.trim();
      savedApiKey = apiKey.trim();
      testResult = null;
    } finally {
      saving = false;
    }
  }

  async function testConnection() {
    if (testing) return;
    testing = true;
    testResult = null;
    try {
      await save();
      // Try a cheap health check + an authed list
      const health = await api.callBackend<{ status: string }>("/health", "GET");
      if (health?.status !== "ok") throw new Error("Backend did not respond with ok");
      // Now verify the API key works by listing datasets
      const list = await api.callBackend<{ datasets?: unknown[] }>("/addon/datasets", "GET");
      testResult = {
        ok: true,
        message: `Connected. ${(list.datasets ?? []).length} dataset(s) accessible.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed.";
      testResult = { ok: false, message: msg };
    } finally {
      testing = false;
    }
  }

  function maskedKey(key: string): string {
    if (!key) return "";
    if (key.length <= 12) return "•".repeat(key.length);
    return key.slice(0, 7) + "•".repeat(Math.max(0, key.length - 11)) + key.slice(-4);
  }

  $: dirty = backendUrl.trim() !== savedBackendUrl || apiKey.trim() !== savedApiKey;
</script>

<div class="settings-page">
  <Header title="Settings" showBack={true} onBack={() => push("/")} />

  {#if loading}
    <div class="center">
      <Spinner size="md" />
    </div>
  {:else}
    <div class="content">
      <section class="block">
        <span class="eyebrow">Backend</span>
        <h3>BigSet API endpoint</h3>
        <p class="muted">Where the add-on should send requests. Use the local Docker URL during development.</p>
        <input
          class="input"
          type="text"
          bind:value={backendUrl}
          placeholder="https://eab6-2a09-bac1-36e0-5d68-00-2a8-5d.ngrok-free.app"
        />
      </section>

      <section class="block">
        <span class="eyebrow">Authentication</span>
        <h3>API key</h3>
        <p class="muted">
          Generate one at <a href="{import.meta.env.VITE_DASHBOARD_URL ?? 'http://localhost:3500'}/dashboard/settings/api-keys" target="_blank" rel="noopener" class="text-link">BigSet dashboard → Settings → API keys</a> and paste it here.
        </p>
        <div class="key-row">
          {#if showKey}
            <input class="input mono" type="text" value={apiKey} on:input={(e) => (apiKey = e.currentTarget.value)} placeholder="bsk_..." autocomplete="off" spellcheck="false" />
          {:else}
            <input class="input mono" type="password" value={apiKey} on:input={(e) => (apiKey = e.currentTarget.value)} placeholder="bsk_..." autocomplete="off" spellcheck="false" />
          {/if}
          <button class="icon-btn" type="button" aria-label="Show/hide" on:click={() => (showKey = !showKey)}>
            <Icon name={showKey ? "close" : "play"} size={12} />
          </button>
        </div>
        {#if savedApiKey && !apiKey}
          <div class="saved-hint">
            <Icon name="key" size={11} />
            <span>Saved: <code>{maskedKey(savedApiKey)}</code></span>
          </div>
        {/if}
      </section>

      {#if testResult}
        <div class="alert" class:alert-error={!testResult.ok} class:alert-info={testResult.ok}>
          <strong>{testResult.ok ? "Connected" : "Couldn't connect"}</strong>
          <div class="error-msg">{testResult.message}</div>
        </div>
      {/if}

      <div class="actions">
        <button class="btn btn-secondary" type="button" on:click={testConnection} disabled={testing || !backendUrl.trim()}>
          {#if testing}
            <Spinner size="sm" />
            Testing…
          {:else}
            <Icon name="link" size={12} />
            Test connection
          {/if}
        </button>
        <button class="btn btn-primary" type="button" on:click={save} disabled={saving || !dirty}>
          {#if saving}
            <Spinner size="sm" />
            Saving…
          {:else}
            Save
          {/if}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--background);
  }

  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .block h3 {
    margin: 4px 0 4px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .block p {
    margin: 0 0 8px;
    font-size: 11px;
    line-height: 1.5;
  }

  .key-row {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }

  .key-row .input {
    flex: 1;
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }

  .mono {
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .saved-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 10px;
    color: var(--muted);
  }

  .saved-hint code {
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    background-color: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .text-link {
    color: var(--link);
    text-decoration: underline;
    text-decoration-color: var(--link-decoration);
    text-underline-offset: 2px;
  }

  .text-link:hover {
    text-decoration-color: var(--link-decoration-hover);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .actions .btn-primary {
    margin-left: auto;
  }

  .error-msg {
    margin-top: 4px;
    opacity: 0.85;
  }
</style>
