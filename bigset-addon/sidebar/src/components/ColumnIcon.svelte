<script lang="ts">
  export let type: "text" | "number" | "boolean" | "url" | "date";

  $: glyph = type === "text" ? "≡"
    : type === "number" ? "#"
    : type === "boolean" ? "■"
    : type === "url" ? "⇗"
    : "☆"; // date
</script>

<span class="col-icon col-icon-{type}">{glyph}</span>

<style>
  /* Uses global .col-icon / .col-icon-{type} classes from app.css */
</style>
