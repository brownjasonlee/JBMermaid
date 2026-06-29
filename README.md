# Mermaid Canvas

A static Mermaid diagram platform for GitHub Pages. Paste Mermaid source, render it in the browser, then pan and zoom the diagram without fixed bounds.

## Features

- Browser-only Mermaid rendering
- Drag to pan
- Mouse wheel or trackpad pinch to zoom with no upper zoom limit
- Fit, reset, copy SVG, and download SVG controls
- GitHub Pages workflow included

## Local Preview

Serve the directory with any static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy To GitHub Pages

1. Push this repository to GitHub.
2. In the repository settings, open **Pages**.
3. Set **Build and deployment** to **GitHub Actions**.
4. The included `.github/workflows/pages.yml` workflow deploys the site from the repository root on every push to `main` or `master`.
