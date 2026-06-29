import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const input = document.querySelector("#mermaidInput");
const renderButton = document.querySelector("#renderButton");
const fitButton = document.querySelector("#fitButton");
const resetButton = document.querySelector("#resetButton");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const viewport = document.querySelector("#viewport");
const surface = document.querySelector("#diagramSurface");
const statusText = document.querySelector("#statusText");
const lineCount = document.querySelector("#lineCount");

const state = {
  x: 60,
  y: 80,
  scale: 1,
  pointers: new Map(),
  activePointerId: null,
  lastPointer: null,
  pinch: null,
  lastSvg: "",
};

let renderSequence = 0;
let renderTimer = null;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "default",
  flowchart: {
    htmlLabels: true,
    useMaxWidth: false,
  },
});

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function updateLineCount() {
  const count = input.value.split(/\r\n|\r|\n/).length;
  lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
}

function applyTransform() {
  surface.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
}

function getSvgElement() {
  return surface.querySelector("svg");
}

function getDiagramBounds() {
  const svg = getSvgElement();
  if (!svg) {
    return null;
  }

  const box = svg.viewBox.baseVal;
  if (box && box.width && box.height) {
    return { width: box.width, height: box.height };
  }

  return {
    width: svg.getBoundingClientRect().width / state.scale,
    height: svg.getBoundingClientRect().height / state.scale,
  };
}

function fitDiagram() {
  const bounds = getDiagramBounds();
  if (!bounds) {
    return;
  }

  const padding = 72;
  const widthScale = (viewport.clientWidth - padding) / bounds.width;
  const heightScale = (viewport.clientHeight - padding) / bounds.height;
  state.scale = Math.max(0.05, Math.min(widthScale, heightScale, 1.6));
  state.x = (viewport.clientWidth - bounds.width * state.scale) / 2;
  state.y = (viewport.clientHeight - bounds.height * state.scale) / 2;
  applyTransform();
}

function resetView() {
  state.x = 60;
  state.y = 80;
  state.scale = 1;
  applyTransform();
}

function sanitizeRenderedSvg(svgText) {
  const parser = new DOMParser();
  const documentResult = parser.parseFromString(svgText, "image/svg+xml");
  const svg = documentResult.querySelector("svg");

  if (!svg) {
    return svgText;
  }

  svg.removeAttribute("style");
  const box = svg.viewBox.baseVal;
  if (box && box.width && box.height) {
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
  }
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return new XMLSerializer().serializeToString(svg);
}

async function renderDiagram({ fit = false } = {}) {
  const source = input.value.trim();
  updateLineCount();

  if (!source) {
    surface.innerHTML = "";
    state.lastSvg = "";
    setStatus("Paste Mermaid code to render");
    return;
  }

  const sequence = ++renderSequence;
  setStatus("Rendering...");

  try {
    const id = `diagram-${Date.now()}-${sequence}`;
    const { svg } = await mermaid.render(id, source);
    if (sequence !== renderSequence) {
      return;
    }

    state.lastSvg = sanitizeRenderedSvg(svg);
    surface.innerHTML = state.lastSvg;
    setStatus("Rendered");
    requestAnimationFrame(() => {
      if (fit) {
        fitDiagram();
      } else {
        applyTransform();
      }
    });
  } catch (error) {
    if (sequence !== renderSequence) {
      return;
    }

    state.lastSvg = "";
    const message = error?.message || String(error);
    surface.innerHTML = `<pre class="render-error">${escapeHtml(message)}</pre>`;
    resetView();
    setStatus("Mermaid syntax error", true);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character];
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderDiagram(), 450);
}

function zoomAt(clientX, clientY, nextScale) {
  const rect = viewport.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const diagramX = (x - state.x) / state.scale;
  const diagramY = (y - state.y) / state.scale;

  state.scale = Math.max(0.000001, nextScale);
  state.x = x - diagramX * state.scale;
  state.y = y - diagramY * state.scale;
  applyTransform();
}

function pointerDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function pointerCenter(a, b) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}

viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, state.scale * factor);
  },
  { passive: false },
);

viewport.addEventListener("pointerdown", (event) => {
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("is-dragging");
  state.pointers.set(event.pointerId, event);

  if (state.pointers.size === 1) {
    state.activePointerId = event.pointerId;
    state.lastPointer = { clientX: event.clientX, clientY: event.clientY };
    state.pinch = null;
  }

  if (state.pointers.size === 2) {
    const [first, second] = Array.from(state.pointers.values());
    state.pinch = {
      distance: pointerDistance(first, second),
      scale: state.scale,
      center: pointerCenter(first, second),
    };
  }
});

viewport.addEventListener("pointermove", (event) => {
  if (!state.pointers.has(event.pointerId)) {
    return;
  }

  state.pointers.set(event.pointerId, event);

  if (state.pointers.size === 2) {
    const [first, second] = Array.from(state.pointers.values());
    const distance = pointerDistance(first, second);
    const center = pointerCenter(first, second);

    if (state.pinch && state.pinch.distance > 0) {
      zoomAt(center.clientX, center.clientY, state.pinch.scale * (distance / state.pinch.distance));
    }
    return;
  }

  if (event.pointerId === state.activePointerId && state.lastPointer) {
    state.x += event.clientX - state.lastPointer.clientX;
    state.y += event.clientY - state.lastPointer.clientY;
    state.lastPointer = { clientX: event.clientX, clientY: event.clientY };
    applyTransform();
  }
});

function releasePointer(event) {
  state.pointers.delete(event.pointerId);

  if (state.pointers.size === 0) {
    viewport.classList.remove("is-dragging");
    state.activePointerId = null;
    state.lastPointer = null;
    state.pinch = null;
    return;
  }

  const [remaining] = Array.from(state.pointers.values());
  state.activePointerId = remaining.pointerId;
  state.lastPointer = { clientX: remaining.clientX, clientY: remaining.clientY };
  state.pinch = null;
}

viewport.addEventListener("pointerup", releasePointer);
viewport.addEventListener("pointercancel", releasePointer);

renderButton.addEventListener("click", () => renderDiagram({ fit: true }));
fitButton.addEventListener("click", fitDiagram);
resetButton.addEventListener("click", resetView);
input.addEventListener("input", () => {
  updateLineCount();
  scheduleRender();
});

copyButton.addEventListener("click", async () => {
  if (!state.lastSvg) {
    setStatus("Nothing to copy", true);
    return;
  }

  await navigator.clipboard.writeText(state.lastSvg);
  setStatus("SVG copied");
});

downloadButton.addEventListener("click", () => {
  if (!state.lastSvg) {
    setStatus("Nothing to download", true);
    return;
  }

  const blob = new Blob([state.lastSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mermaid-diagram.svg";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("SVG downloaded");
});

window.addEventListener("resize", () => fitDiagram());

updateLineCount();
applyTransform();
renderDiagram({ fit: true });
