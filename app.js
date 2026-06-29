import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const DEFAULT_TITLE = "Untitled Diagram";
const DEFAULT_SOURCE = `flowchart LR
  A[Paste Mermaid code] --> B{Render}
  B -->|Drag| C[Pan anywhere]
  B -->|Wheel or pinch| D[Zoom without limits]
  C --> E[Export SVG]
  D --> E`;

const DB_NAME = "mermaid-canvas";
const DB_VERSION = 1;
const DB_STORE = "handles";
const DIRECTORY_KEY = "lastDirectory";

const input = document.querySelector("#mermaidInput");
const titleInput = document.querySelector("#diagramTitle");
const renderButton = document.querySelector("#renderButton");
const toggleGalleryButton = document.querySelector("#toggleGalleryButton");
const toggleEditorButton = document.querySelector("#toggleEditorButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const fitButton = document.querySelector("#fitButton");
const resetButton = document.querySelector("#resetButton");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const chooseFolderButton = document.querySelector("#chooseFolderButton");
const refreshGalleryButton = document.querySelector("#refreshGalleryButton");
const newDiagramButton = document.querySelector("#newDiagramButton");
const saveDiagramButton = document.querySelector("#saveDiagramButton");
const saveAsDiagramButton = document.querySelector("#saveAsDiagramButton");
const galleryGrid = document.querySelector("#galleryGrid");
const galleryStatus = document.querySelector("#galleryStatus");
const folderName = document.querySelector("#folderName");
const viewport = document.querySelector("#viewport");
const surface = document.querySelector("#diagramSurface");
const canvasPane = document.querySelector(".canvas-pane");
const statusText = document.querySelector("#statusText");
const lineCount = document.querySelector("#lineCount");
const appShell = document.querySelector(".app-shell");

const supportsLocalFolders =
  "showDirectoryPicker" in window &&
  "indexedDB" in window &&
  window.isSecureContext;

const state = {
  x: 60,
  y: 80,
  scale: 1,
  pointers: new Map(),
  activePointerId: null,
  lastPointer: null,
  pinch: null,
  lastSvg: "",
  manualLayout: null,
  dragNode: null,
  layoutDirty: false,
  sourceDirty: false,
  directoryHandle: null,
  diagrams: [],
  currentFileName: null,
  galleryHidden: false,
  editorHidden: false,
  fullscreen: false,
};

let renderSequence = 0;
let renderTimer = null;
let renderId = 0;

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

function setGalleryStatus(message, isError = false) {
  galleryStatus.textContent = message;
  galleryStatus.classList.toggle("error", isError);
}

function updateLineCount() {
  const count = input.value.split(/\r\n|\r|\n/).length;
  lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
}

function updateButtonStates() {
  const hasDirectory = Boolean(state.directoryHandle);
  chooseFolderButton.disabled = !supportsLocalFolders;
  refreshGalleryButton.disabled = !supportsLocalFolders || !hasDirectory;
  saveDiagramButton.disabled = !supportsLocalFolders || !hasDirectory;
  saveAsDiagramButton.disabled = !supportsLocalFolders || !hasDirectory;
}

function applyLayoutState() {
  appShell.classList.toggle("is-gallery-hidden", state.galleryHidden);
  appShell.classList.toggle("is-editor-hidden", state.editorHidden);
  appShell.classList.toggle("is-fullscreen", state.fullscreen);
  toggleGalleryButton.setAttribute("aria-pressed", String(state.galleryHidden || state.fullscreen));
  toggleEditorButton.setAttribute("aria-pressed", String(state.editorHidden || state.fullscreen));
  fullscreenButton.setAttribute("aria-pressed", String(state.fullscreen));
  toggleGalleryButton.textContent = state.galleryHidden || state.fullscreen ? "Show Gallery" : "Hide Gallery";
  toggleEditorButton.textContent = state.editorHidden || state.fullscreen ? "Show Code" : "Hide Code";
  fullscreenButton.textContent = state.fullscreen ? "Exit Full Screen" : "Full Screen";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitDiagram());
  });
}

function setFullscreen(enabled) {
  state.fullscreen = enabled;
  applyLayoutState();
}

async function toggleFullscreen() {
  if (state.fullscreen) {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    setFullscreen(false);
    return;
  }

  setFullscreen(true);
  if (canvasPane.requestFullscreen) {
    try {
      await canvasPane.requestFullscreen();
    } catch {
      // CSS fullscreen still expands the canvas when browser fullscreen is unavailable.
    }
  }
}

function toggleGalleryPanel() {
  if (state.fullscreen) {
    state.fullscreen = false;
    state.galleryHidden = false;
  } else {
    state.galleryHidden = !state.galleryHidden;
  }
  applyLayoutState();
}

function toggleEditorPanel() {
  if (state.fullscreen) {
    state.fullscreen = false;
    state.editorHidden = false;
  } else {
    state.editorHidden = !state.editorHidden;
  }
  applyLayoutState();
}

function applyTransform() {
  surface.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;

  const svg = getSvgElement();
  const bounds = getDiagramBounds();
  if (svg && bounds) {
    svg.style.width = `${bounds.width * state.scale}px`;
    svg.style.height = `${bounds.height * state.scale}px`;
  }
}

function parseTranslate(transform) {
  const match = /translate\(\s*([-.\d]+)(?:[,\s]+([-.\d]+))?\s*\)/.exec(transform || "");
  return {
    x: match ? Number.parseFloat(match[1]) : 0,
    y: match && match[2] ? Number.parseFloat(match[2]) : 0,
  };
}

function setTranslate(element, point) {
  element.setAttribute("transform", `translate(${point.x}, ${point.y})`);
}

function getNodeKey(node) {
  const match = /-flowchart-(.+)-\d+$/.exec(node.id);
  return match ? match[1] : "";
}

function getNodeShapeBounds(node) {
  const shape = node.querySelector(".label-container");
  if (!shape) {
    return { left: -40, right: 40, top: -24, bottom: 24 };
  }

  const offset = parseTranslate(shape.getAttribute("transform"));

  if (shape.tagName.toLowerCase() === "rect") {
    const x = Number.parseFloat(shape.getAttribute("x")) || 0;
    const y = Number.parseFloat(shape.getAttribute("y")) || 0;
    const width = Number.parseFloat(shape.getAttribute("width")) || 80;
    const height = Number.parseFloat(shape.getAttribute("height")) || 48;
    return {
      left: x + offset.x,
      right: x + width + offset.x,
      top: y + offset.y,
      bottom: y + height + offset.y,
    };
  }

  if (shape.tagName.toLowerCase() === "polygon") {
    const points = (shape.getAttribute("points") || "")
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (points.length) {
      return {
        left: Math.min(...points.map(([x]) => x)) + offset.x,
        right: Math.max(...points.map(([x]) => x)) + offset.x,
        top: Math.min(...points.map(([, y]) => y)) + offset.y,
        bottom: Math.max(...points.map(([, y]) => y)) + offset.y,
      };
    }
  }

  if (shape.getBBox) {
    try {
      const box = shape.getBBox();
      return {
        left: box.x + offset.x,
        right: box.x + box.width + offset.x,
        top: box.y + offset.y,
        bottom: box.y + box.height + offset.y,
      };
    } catch {
      return { left: -40, right: 40, top: -24, bottom: 24 };
    }
  }

  return { left: -40, right: 40, top: -24, bottom: 24 };
}

function edgeEndpoint(from, to, bounds) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const width = Math.max(Math.abs(bounds.left), Math.abs(bounds.right), 1);
  const height = Math.max(Math.abs(bounds.top), Math.abs(bounds.bottom), 1);
  const scale = Math.max(Math.abs(dx) / width, Math.abs(dy) / height, 1);
  return {
    x: from.x + dx / scale,
    y: from.y + dy / scale,
  };
}

function connectorPath(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const span = Math.abs(horizontal ? dx : dy);
  const curve = Math.min(span * 0.45, 160);

  if (horizontal) {
    const direction = dx >= 0 ? 1 : -1;
    return `M${start.x},${start.y} C${start.x + curve * direction},${start.y} ${end.x - curve * direction},${end.y} ${end.x},${end.y}`;
  }

  const direction = dy >= 0 ? 1 : -1;
  return `M${start.x},${start.y} C${start.x},${start.y + curve * direction} ${end.x},${end.y - curve * direction} ${end.x},${end.y}`;
}

function parseEdgeNodes(edgePath, nodeKeys) {
  const edgeKey = getEdgeKey(edgePath);
  const edgeBody = edgeKey.replace(/^L_/, "").replace(/_\d+$/, "");
  if (!edgeBody) {
    return null;
  }

  for (const fromKey of nodeKeys) {
    const prefix = `${fromKey}_`;
    if (!edgeBody.startsWith(prefix)) {
      continue;
    }
    const toKey = edgeBody.slice(prefix.length);
    if (nodeKeys.includes(toKey)) {
      return { fromKey, toKey };
    }
  }

  return null;
}

function getEdgeKey(edgePath) {
  const match = /-(L_.+_\d+)$/.exec(edgePath.id);
  return match ? match[1] : "";
}

function initializeManualLayout() {
  const svg = getSvgElement();
  if (!svg) {
    state.manualLayout = null;
    state.layoutDirty = false;
    return;
  }

  const nodes = Array.from(svg.querySelectorAll("g.node[id*='-flowchart-']"));
  if (!nodes.length) {
    state.manualLayout = null;
    state.layoutDirty = false;
    return;
  }

  const nodeMap = new Map();
  for (const node of nodes) {
    const key = getNodeKey(node);
    if (!key) {
      continue;
    }

    const center = parseTranslate(node.getAttribute("transform"));
    nodeMap.set(key, {
      key,
      element: node,
      center,
      bounds: getNodeShapeBounds(node),
    });
    node.classList.add("draggable-node");
    node.setAttribute("tabindex", "0");
  }

  const nodeKeys = Array.from(nodeMap.keys());
  const edgeLabels = new Map(
    Array.from(svg.querySelectorAll("g.edgeLabel g.label[data-id]")).map((label) => [
      label.getAttribute("data-id"),
      label.closest("g.edgeLabel"),
    ]),
  );
  const edges = Array.from(svg.querySelectorAll("path.flowchart-link"))
    .map((path) => {
      const endpoints = parseEdgeNodes(path, nodeKeys);
      if (!endpoints) {
        return null;
      }

      const edgeLabel = edgeLabels.get(getEdgeKey(path)) || null;
      return { path, edgeLabel, ...endpoints };
    })
    .filter(Boolean);

  state.manualLayout = { svg, nodeMap, edges };
  updateConnectedEdges();
}

function updateConnectedEdges() {
  if (!state.manualLayout) {
    return;
  }

  for (const edge of state.manualLayout.edges) {
    const from = state.manualLayout.nodeMap.get(edge.fromKey);
    const to = state.manualLayout.nodeMap.get(edge.toKey);
    if (!from || !to) {
      continue;
    }

    const start = edgeEndpoint(from.center, to.center, from.bounds);
    const end = edgeEndpoint(to.center, from.center, to.bounds);
    edge.path.setAttribute("d", connectorPath(start, end));

    if (edge.edgeLabel && edge.edgeLabel.textContent.trim()) {
      setTranslate(edge.edgeLabel, {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      });
    }
  }
}

function pointerToSvgPoint(event) {
  const svg = getSvgElement();
  if (!svg) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function serializeCurrentSvg() {
  const svg = getSvgElement();
  if (!svg) {
    return "";
  }

  const clone = svg.cloneNode(true);
  clone.style.removeProperty("width");
  clone.style.removeProperty("height");
  clone.querySelectorAll(".draggable-node").forEach((node) => {
    node.classList.remove("draggable-node", "is-dragging-node");
    node.removeAttribute("tabindex");
  });
  return new XMLSerializer().serializeToString(clone);
}

function syncCurrentLayoutSvg() {
  if (state.manualLayout && !state.sourceDirty) {
    state.lastSvg = serializeCurrentSvg();
    state.layoutDirty = false;
  }
}

function handleNodePointerDown(event) {
  const nodeElement = event.target.closest?.("g.draggable-node");
  if (!nodeElement || !state.manualLayout) {
    return;
  }

  const key = getNodeKey(nodeElement);
  const node = state.manualLayout.nodeMap.get(key);
  const startPoint = pointerToSvgPoint(event);
  if (!node || !startPoint) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  surface.setPointerCapture(event.pointerId);
  nodeElement.classList.add("is-dragging-node");
  state.dragNode = {
    pointerId: event.pointerId,
    key,
    startPoint,
    startCenter: { ...node.center },
  };
}

function handleNodePointerMove(event) {
  if (!state.dragNode || event.pointerId !== state.dragNode.pointerId || !state.manualLayout) {
    return;
  }

  const currentPoint = pointerToSvgPoint(event);
  const node = state.manualLayout.nodeMap.get(state.dragNode.key);
  if (!currentPoint || !node) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  node.center = {
    x: state.dragNode.startCenter.x + currentPoint.x - state.dragNode.startPoint.x,
    y: state.dragNode.startCenter.y + currentPoint.y - state.dragNode.startPoint.y,
  };
  setTranslate(node.element, node.center);
  updateConnectedEdges();
  state.layoutDirty = true;
}

function handleNodePointerUp(event) {
  if (!state.dragNode || event.pointerId !== state.dragNode.pointerId || !state.manualLayout) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const node = state.manualLayout.nodeMap.get(state.dragNode.key);
  node?.element.classList.remove("is-dragging-node");
  state.dragNode = null;
  syncCurrentLayoutSvg();
  setStatus("Layout adjusted");
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

  const width = Number.parseFloat(svg.getAttribute("width"));
  const height = Number.parseFloat(svg.getAttribute("height"));
  if (width && height) {
    return { width, height };
  }

  return {
    width: svg.getBoundingClientRect().width,
    height: svg.getBoundingClientRect().height,
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

  svg.querySelectorAll("script").forEach((script) => script.remove());
  svg.removeAttribute("style");
  const box = svg.viewBox.baseVal;
  if (box && box.width && box.height) {
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
  }
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return new XMLSerializer().serializeToString(svg);
}

async function renderMermaidSvg(source) {
  const id = `diagram-${Date.now()}-${++renderId}`;
  const { svg } = await mermaid.render(id, source.trim());
  return sanitizeRenderedSvg(svg);
}

async function renderDiagram({ fit = false } = {}) {
  const source = input.value.trim();
  updateLineCount();

  if (!source) {
    surface.innerHTML = "";
    state.lastSvg = "";
    state.manualLayout = null;
    state.layoutDirty = false;
    state.sourceDirty = false;
    setStatus("Paste Mermaid code to render");
    return false;
  }

  const sequence = ++renderSequence;
  setStatus("Rendering...");

  try {
    const svg = await renderMermaidSvg(source);
    if (sequence !== renderSequence) {
      return false;
    }

    state.lastSvg = svg;
    state.layoutDirty = false;
    state.sourceDirty = false;
    surface.innerHTML = state.lastSvg;
    initializeManualLayout();
    setStatus("Rendered");
    requestAnimationFrame(() => {
      if (fit) {
        fitDiagram();
      } else {
        applyTransform();
      }
    });
    return true;
  } catch (error) {
    if (sequence !== renderSequence) {
      return false;
    }

    state.lastSvg = "";
    state.manualLayout = null;
    state.layoutDirty = false;
    state.sourceDirty = false;
    const message = error?.message || String(error);
    surface.innerHTML = `<pre class="render-error">${escapeHtml(message)}</pre>`;
    resetView();
    setStatus("Mermaid syntax error", true);
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
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

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDirectoryHandle(handle) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put(handle, DIRECTORY_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getStoredDirectoryHandle() {
  const db = await openDatabase();
  const handle = await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readonly");
    const request = transaction.objectStore(DB_STORE).get(DIRECTORY_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function ensureDirectoryPermission({ prompt = false } = {}) {
  if (!state.directoryHandle) {
    return false;
  }

  const options = { mode: "readwrite" };
  if (state.directoryHandle.queryPermission) {
    const current = await state.directoryHandle.queryPermission(options);
    if (current === "granted") {
      return true;
    }
  }

  if (!prompt || !state.directoryHandle.requestPermission) {
    return false;
  }

  return (await state.directoryHandle.requestPermission(options)) === "granted";
}

async function chooseFolder() {
  if (!supportsLocalFolders) {
    setGalleryStatus("Local folders are not supported in this browser.", true);
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.directoryHandle = handle;
    folderName.textContent = handle.name;
    await storeDirectoryHandle(handle);
    updateButtonStates();
    await loadGallery({ prompt: true });
  } catch (error) {
    if (error?.name !== "AbortError") {
      setGalleryStatus(error?.message || "Could not open that folder.", true);
    }
  }
}

async function loadStoredFolder() {
  if (!supportsLocalFolders) {
    setGalleryStatus("Local folders are not supported in this browser.", true);
    galleryGrid.innerHTML = "";
    updateButtonStates();
    return;
  }

  try {
    const handle = await getStoredDirectoryHandle();
    if (!handle) {
      updateButtonStates();
      return;
    }

    state.directoryHandle = handle;
    folderName.textContent = handle.name;
    updateButtonStates();

    if (await ensureDirectoryPermission()) {
      await loadGallery();
    } else {
      setGalleryStatus("Folder remembered. Click Refresh to grant access.");
    }
  } catch (error) {
    setGalleryStatus(error?.message || "Could not restore the previous folder.", true);
  }
}

async function loadGallery({ prompt = false, statusMessage = null } = {}) {
  if (!state.directoryHandle) {
    setGalleryStatus("Choose a folder to show local Mermaid files.");
    return;
  }

  if (!(await ensureDirectoryPermission({ prompt }))) {
    setGalleryStatus("Folder access was not granted.", true);
    return;
  }

  setGalleryStatus("Loading local Mermaid files...");
  const diagrams = [];

  try {
    for await (const [name, handle] of state.directoryHandle.entries()) {
      if (handle.kind === "file" && name.toLowerCase().endsWith(".mmd")) {
        const source = await (await handle.getFile()).text();
        const stem = name.slice(0, -4);
        const svgName = `${stem}.svg`;
        const existingSvg = await readTextFileIfExists(svgName);
        let previewSvg = existingSvg ? sanitizeRenderedSvg(existingSvg) : "";
        let error = "";

        if (!previewSvg) {
          try {
            previewSvg = await renderMermaidSvg(source);
          } catch (renderError) {
            error = renderError?.message || "Could not render this diagram.";
          }
        }

        diagrams.push({
          fileName: name,
          stem,
          title: titleFromStem(stem),
          source,
          previewSvg,
          error,
        });
      }
    }

    diagrams.sort((a, b) => a.title.localeCompare(b.title));
    state.diagrams = diagrams;
    renderGallery();
    setGalleryStatus(statusMessage || `${diagrams.length} ${diagrams.length === 1 ? "diagram" : "diagrams"} loaded.`);
  } catch (error) {
    setGalleryStatus(error?.message || "Could not read that folder.", true);
  }
}

async function readTextFileIfExists(fileName) {
  try {
    const handle = await state.directoryHandle.getFileHandle(fileName);
    return await (await handle.getFile()).text();
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return "";
    }
    throw error;
  }
}

function renderGallery() {
  galleryGrid.innerHTML = "";

  if (!state.diagrams.length) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No .mmd files found in this folder.";
    galleryGrid.append(empty);
    return;
  }

  for (const diagram of state.diagrams) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.classList.toggle("is-active", diagram.fileName === state.currentFileName);
    card.addEventListener("click", () => openDiagram(diagram));

    const thumbnail = document.createElement("span");
    thumbnail.className = "thumbnail";
    if (diagram.previewSvg) {
      thumbnail.innerHTML = diagram.previewSvg;
    } else {
      thumbnail.innerHTML = `<span class="thumbnail-error">Error</span>`;
    }

    const details = document.createElement("span");
    const title = document.createElement("span");
    title.className = "gallery-card-title";
    title.textContent = diagram.title;
    const meta = document.createElement("span");
    meta.className = "gallery-card-meta";
    meta.textContent = diagram.error ? "Mermaid syntax error" : diagram.fileName;
    details.append(title, meta);
    card.append(thumbnail, details);
    galleryGrid.append(card);
  }
}

function openDiagram(diagram) {
  state.currentFileName = diagram.fileName;
  titleInput.value = diagram.title;
  input.value = diagram.source;
  updateLineCount();
  renderGallery();
  renderDiagram({ fit: true });
  setGalleryStatus(`Opened ${diagram.fileName}${diagram.error ? " with syntax errors." : "."}`, Boolean(diagram.error));
}

function newDiagram() {
  state.currentFileName = null;
  titleInput.value = DEFAULT_TITLE;
  input.value = DEFAULT_SOURCE;
  updateLineCount();
  renderGallery();
  renderDiagram({ fit: true });
  setGalleryStatus("New unsaved diagram.");
}

async function saveDiagram({ saveAs = false } = {}) {
  if (!state.directoryHandle) {
    setGalleryStatus("Choose a folder before saving.", true);
    return;
  }

  if (!(await ensureDirectoryPermission({ prompt: true }))) {
    setGalleryStatus("Folder access was not granted.", true);
    return;
  }

  const source = input.value;
  if (!source.trim()) {
    setGalleryStatus("Add Mermaid source before saving.", true);
    return;
  }

  if (state.sourceDirty || !state.lastSvg) {
    await renderDiagram();
  } else {
    syncCurrentLayoutSvg();
  }
  const creatingNewFile = saveAs || !state.currentFileName;
  const stem = creatingNewFile
    ? await nextAvailableStem(slugify(titleInput.value))
    : state.currentFileName.replace(/\.[^.]+$/, "");
  const mmdName = creatingNewFile ? `${stem}.mmd` : state.currentFileName;
  const svgName = `${stem}.svg`;

  try {
    await writeTextFile(mmdName, source);
    if (state.lastSvg) {
      await writeTextFile(svgName, state.lastSvg);
      setGalleryStatus(`Saved ${mmdName} and ${svgName}.`);
    } else {
      setGalleryStatus(`Saved ${mmdName}. SVG was not updated because the source has syntax errors.`, true);
    }
    state.currentFileName = mmdName;
    titleInput.value = titleFromStem(stem);
    await loadGallery({ statusMessage: `Saved ${mmdName}.` });
  } catch (error) {
    setGalleryStatus(error?.message || "Could not save the diagram.", true);
  }
}

async function writeTextFile(fileName, contents) {
  const handle = await state.directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function nextAvailableStem(baseStem) {
  const existing = new Set();

  for await (const [name, handle] of state.directoryHandle.entries()) {
    if (handle.kind === "file") {
      existing.add(name.toLowerCase());
    }
  }

  let stem = baseStem || "untitled-diagram";
  let counter = 2;
  while (existing.has(`${stem}.mmd`) || existing.has(`${stem}.svg`)) {
    stem = `${baseStem}-${counter}`;
    counter += 1;
  }
  return stem;
}

function slugify(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled-diagram";
}

function titleFromStem(stem) {
  return stem
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || DEFAULT_TITLE;
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

surface.addEventListener("pointerdown", handleNodePointerDown, true);
surface.addEventListener("pointermove", handleNodePointerMove, true);
surface.addEventListener("pointerup", handleNodePointerUp, true);
surface.addEventListener("pointercancel", handleNodePointerUp, true);

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
toggleGalleryButton.addEventListener("click", toggleGalleryPanel);
toggleEditorButton.addEventListener("click", toggleEditorPanel);
fullscreenButton.addEventListener("click", toggleFullscreen);
fitButton.addEventListener("click", fitDiagram);
resetButton.addEventListener("click", resetView);
chooseFolderButton.addEventListener("click", chooseFolder);
refreshGalleryButton.addEventListener("click", () => loadGallery({ prompt: true }));
newDiagramButton.addEventListener("click", newDiagram);
saveDiagramButton.addEventListener("click", () => saveDiagram());
saveAsDiagramButton.addEventListener("click", () => saveDiagram({ saveAs: true }));
input.addEventListener("input", () => {
  state.sourceDirty = true;
  updateLineCount();
  scheduleRender();
});

copyButton.addEventListener("click", async () => {
  syncCurrentLayoutSvg();
  if (!state.lastSvg) {
    setStatus("Nothing to copy", true);
    return;
  }

  await navigator.clipboard.writeText(state.lastSvg);
  setStatus("SVG copied");
});

downloadButton.addEventListener("click", () => {
  syncCurrentLayoutSvg();
  if (!state.lastSvg) {
    setStatus("Nothing to download", true);
    return;
  }

  const blob = new Blob([state.lastSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(titleInput.value)}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("SVG downloaded");
});

window.addEventListener("resize", () => fitDiagram());
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.fullscreen) {
    setFullscreen(false);
  }
});

updateLineCount();
updateButtonStates();
applyLayoutState();
applyTransform();
renderDiagram({ fit: true });
loadStoredFolder();
