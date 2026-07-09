import { defineConfig } from "vite";

// Library-mode build: emit a single self-contained IIFE at the repo root as
// `bundle.js`, loaded by index.html/options via a plain <script>. This keeps the
// existing gh-pages-at-root layout and the zip packaging scripts unchanged.
export default defineConfig({
  build: {
    outDir: ".",
    emptyOutDir: false,
    sourcemap: true,
    minify: "terser",
    lib: {
      entry: "src/index.ts",
      name: "himawari",
      formats: ["iife"],
      fileName: () => "bundle.js",
    },
  },
});
