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
const statusText = document.querySelector("#statusText");
const lineCount = document.querySelector("#lineCount");

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
  directoryHandle: null,
  diagrams: [],
  currentFileName: null,
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

function applyTransform() {
  surface.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;

  const svg = getSvgElement();
  const bounds = getDiagramBounds();
  if (svg && bounds) {
    svg.style.width = `${bounds.width * state.scale}px`;
    svg.style.height = `${bounds.height * state.scale}px`;
  }
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
    surface.innerHTML = state.lastSvg;
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

  await renderDiagram();
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
chooseFolderButton.addEventListener("click", chooseFolder);
refreshGalleryButton.addEventListener("click", () => loadGallery({ prompt: true }));
newDiagramButton.addEventListener("click", newDiagram);
saveDiagramButton.addEventListener("click", () => saveDiagram());
saveAsDiagramButton.addEventListener("click", () => saveDiagram({ saveAs: true }));
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
  link.download = `${slugify(titleInput.value)}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("SVG downloaded");
});

window.addEventListener("resize", () => fitDiagram());

updateLineCount();
updateButtonStates();
applyTransform();
renderDiagram({ fit: true });
loadStoredFolder();
