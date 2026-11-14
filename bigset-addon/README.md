# BigSet Google Sheet Add-on

Build and enrich datasets from any Google Sheet using natural language. The add-on lets you:

- **Generate** — describe a dataset in plain English and the add-on creates the schema and populates it via web search
- **Enrich** — fill in missing cells in an existing sheet using AI-powered research
- **Insert** — write any dataset back into the active sheet

## Architecture

```text
bigset-addon/
├── src/                    # Google Apps Script (TypeScript → pushed to Google)
│   ├── index.ts            # Add-on entry: menu, sidebar, HTTP proxy, sheet ops
│   ├── appsscript.json     # Manifest (OAuth scopes, triggers)
│   └── sidebar.html        # Built sidebar UI (from sidebar/ build)
│
└── sidebar/                # Svelte SPA (builds into src/)
    ├── src/
    │   ├── api/            # google.script.run client
    │   ├── components/     # Shared UI components
    │   ├── pages/          # Route pages + enrich/ sub-pages
    │   ├── stores/         # Svelte writable stores
    │   ├── App.svelte      # Router (#/, #/settings, etc.)
    │   └── main.ts         # Sidebar entry point
    └── sidebar.html        # HTML shell for the SPA
```

**Deployment flow:** `sidebar/` builds → `src/` receives built HTML/JS → `tsc` compiles `index.ts` → `index.js` → `clasp push` deploys to Google Apps Script.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Apps Script project

You need an Apps Script project to push to. Create one at <https://script.google.com/home/projects/>:

1. Click **+ New project** (top left).
2. Rename it to `BigSet Addon` (click the title in the toolbar).
3. Copy the **script ID** from the URL bar — it looks like:
   ```text
   https://script.google.com/home/projects/1Lu2qMd7YE8QUvECiKQpPdv-1_tQU-LAMWRvVUHQ-m5lEIG-q0HPQ1X-t/edit
   ```
   The long string between `/projects/` and `/edit` is your script ID.
4. Open `.clasp.json` in this repo and paste the ID as `scriptId`.

> **Alternatively:** `npm run clasp:create` will create a brand-new Apps Script project and write the ID to `.clasp.json` for you. Note: this only works for the very first setup — running it again will overwrite the existing project.

### 3. Install the manifest

The repo ships an `appsscript.json` that declares the OAuth scopes and add-on metadata. To load it into your new project:

1. In the Apps Script editor, open **Project Settings** (gear icon, left sidebar).
2. Enable **"Show 'appsscript.json' manifest in editor"**.
3. Go back to **Editor** and click `appsscript.json`.
4. Paste the contents of `src/appsscript.json` from this repo and save.

### 4. Log in with clasp

```bash
npm run clasp:login
```

This opens a browser window for Google OAuth. After authorizing, your credentials are stored locally.

### 5. Build and push

```bash
npm run build && clasp push
```

This:
- Builds the Svelte sidebar → copies HTML/JS into `src/`
- Compiles `src/index.ts` → `src/index.js` (TypeScript types are stripped)
- Pushes everything in `src/` to the Apps Script project

After the first push, the add-on is live in your Apps Script project. Open any Google Sheet, refresh, and the **BigSet → Open** menu item should appear.

## Developing the sidebar

```bash
cd sidebar
npm install
npm run dev     # Vite dev server at localhost:5173
```

The sidebar dev server proxies `google.script.run` calls to the Apps Script environment. Changes to Svelte files hot-reload without a full deploy.

To test against a live backend, set the sidebar's environment variable:

```bash
VITE_DASHBOARD_URL=https://your-dashboard-url.com npm run dev
```

## Sheet permissions

The add-on uses `spreadsheets.currentonly` scope — it can only read the active spreadsheet. Required scopes are declared in `src/appsscript.json`.

## Backend requirements

The add-on communicates with the BigSet backend API. On first use, enter your backend URL and API key in **Settings**. Per-user credentials are stored via `PropertiesService.getUserProperties()` so each user maintains their own authentication.

## Config files reference

The project has two layers (Apps Script side and Svelte SPA side), each with its own config. They look similar but serve different toolchains — don't merge them.

### Apps Script side (repo root)

**`package.json`** — Build orchestration for the Apps Script side. Scripts: `build` (chains sidebar build + tsc + copy), `build:tsc` (compiles `src/index.ts` → `src/index.js`), `clasp:create` / `clasp:login` / `deploy`. Dev deps: `typescript`, `@google/clasp`, `@types/google-apps-script`, `shx`, `npm-run-all`.

**`tsconfig.json`** — TypeScript config for the server-side code. `target: ES2020`, `module: none` (Apps Script uses globals, not modules), `outDir: ./src` (emits `index.js` next to `index.ts`), `types: ["google-apps-script"]` (loads globals like `SpreadsheetApp`, `HtmlService`, `PropertiesService`). Includes only `src/**/*.ts`, excludes `node_modules` and `sidebar/`.

**`.clasp.json`** — clasp config. `scriptId` is the Apps Script project ID (see Setup step 2). `rootDir: "src"` tells clasp what to push. `scriptExtensions` lists which file types to upload.

**`.claspignore`** — Excludes everything except `src/` from the push (drops `node_modules/`, `sidebar/`, configs, docs). Also excludes `*.ts` after `!src/**` so the source `index.ts` isn't pushed — only the compiled `index.js` goes to Apps Script.

**`src/appsscript.json`** — Apps Script manifest. Declares OAuth scopes (`spreadsheets.currentonly`), add-on metadata, runtime version. **Don't regenerate** this with `clasp create` or you'll overwrite scopes and add-on config.

### Sidebar side (`sidebar/`)

**`package.json`** — Svelte SPA dependencies and scripts. `dev` (Vite dev server), `build` (Vite production build → `dist/`). Dev deps: `vite`, `svelte`, `@sveltejs/vite-plugin-svelte`, `vite-plugin-singlefile` (inlines everything into one HTML file), `typescript`.

**`tsconfig.json`** — TS config for the SPA. `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`. Extends `@tsconfig/svelte` which sets the compiler options Svelte expects. Type-checks `src/**/*.ts` and `*.svelte` files for editor IntelliSense.

**`tsconfig.node.json`** — Separate tsconfig for `vite.config.ts` itself, since the build config runs in Node (not the browser). Referenced via `references` in the main tsconfig.

**`vite.config.ts`** — Vite build config. Registers the Svelte plugin and `vite-plugin-singlefile` (collapses all JS/CSS into a single HTML file — required for Apps Script's `HtmlService`). `rollupOptions.input` points at `sidebar.html` as the entry HTML shell.

**`svelte.config.js`** — Tells the Svelte compiler to use Vite's preprocessor (handles `<script lang="ts">` blocks and TypeScript in `.svelte` files).

**`sidebar.html`** — HTML shell that Vite reads as the entry point. Contains the `<div id="app">` mount node, the pre-hydration theme script (sets `data-theme` on `<html>` before Svelte boots to prevent a light/dark flash), and the `<script type="module" src="/src/main.ts">` reference that Vite replaces with the bundled output.

### Generated files (gitignored or auto-overwritten)

These are produced by `npm run build` and should never be edited by hand:

- `src/index.js` — compiled from `src/index.ts` by `tsc`
- `src/sidebar.html` — built from `sidebar/` by Vite
- `sidebar/dist/` — Vite's intermediate build output, copied to `src/` by `build:post`

