"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Pen,
  Eraser,
  RotateCcw,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Upload,
  LineChart,
  AlertCircle,
  X,
  Play,
  Loader2,
  HelpCircle,
  Settings,
  Crop,
  Check,
  ClipboardPaste,
  MessageSquare,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Sun,
  Moon,
  Zap,
  BookOpen,
  Trash2
} from "lucide-react";

interface ErrorAnnotation {
  incorrectTerm: string;
  hint: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
}

interface GraphData {
  needed: boolean;
  function: string;
  title: string;
  xMin?: number;
  xMax?: number;
}

// Moveable & Resizable Worksheet / Screenshot Object
interface AdjustablePhoto {
  id: number;
  src: string;
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
}

interface SavedNotebook {
  id: string;
  title: string;
  updatedAt: number;
  width: number;
  height: number;
  ink: string;
  photos: Array<Omit<AdjustablePhoto, "img">>;
}

const NOTEBOOK_DB_NAME = "scribe-agent-notebooks";
const NOTEBOOK_STORE_NAME = "notebooks";

function openNotebookDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTEBOOK_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(NOTEBOOK_STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function listSavedNotebooks(): Promise<SavedNotebook[]> {
  const db = await openNotebookDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(NOTEBOOK_STORE_NAME, "readonly").objectStore(NOTEBOOK_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as SavedNotebook[]);
    request.onerror = () => reject(request.error);
  });
}

async function putSavedNotebook(notebook: SavedNotebook): Promise<void> {
  const db = await openNotebookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(NOTEBOOK_STORE_NAME, "readwrite");
    transaction.objectStore(NOTEBOOK_STORE_NAME).put(notebook);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteSavedNotebook(id: string): Promise<void> {
  const db = await openNotebookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(NOTEBOOK_STORE_NAME, "readwrite");
    transaction.objectStore(NOTEBOOK_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Small numeric clamp helper
function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compile2DGraph(expression: string): ((x: number) => number) | null {
  const normalized = expression
    .replace(/y\s*=/gi, "")
    .replace(/[×·]/g, "*")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi");
  const tokens = normalized.match(/\d+(?:\.\d+)?|sin|cos|tan|sqrt|abs|log|exp|pi|e|x|[()+\-*/^]/gi);
  if (!tokens || tokens.join("").replace(/\s/g, "") !== normalized.replace(/\s/g, "")) return null;

  const allowed = new Set(["x", "pi", "e", "sin", "cos", "tan", "sqrt", "abs", "log", "exp"]);
  if (tokens.some((token) => /[a-z]/i.test(token) && !allowed.has(token.toLowerCase()))) return null;

  const normalizedTokens: string[] = [];
  const endsValue = (token: string) => /^(?:\d|x$|pi$|e$|\))|^\d/.test(token.toLowerCase());
  const startsValue = (token: string) => /^(?:\d|x$|pi$|e$|sin$|cos$|tan$|sqrt$|abs$|log$|exp$|\()/.test(token.toLowerCase());
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (previous && endsValue(previous) && startsValue(token)) normalizedTokens.push("*");
    normalizedTokens.push(token.toLowerCase() === "pi" ? "Math.PI" : token.toLowerCase() === "e" ? "Math.E" : token);
  });

  const jsExpression = normalizedTokens.join("").replace(/\^/g, "**");
  try {
    const fn = new Function(
      "x", "sin", "cos", "tan", "sqrt", "abs", "log", "exp",
      `"use strict"; return (${jsExpression});`
    ) as (
      x: number,
      sin: typeof Math.sin,
      cos: typeof Math.cos,
      tan: typeof Math.tan,
      sqrt: typeof Math.sqrt,
      abs: typeof Math.abs,
      log: typeof Math.log,
      exp: typeof Math.exp
    ) => number;
    return (x: number) => {
      const result = fn(x, Math.sin, Math.cos, Math.tan, Math.sqrt, Math.abs, Math.log, Math.exp);
      return Number.isFinite(result) ? result : Number.NaN;
    };
  } catch {
    return null;
  }
}

// Gnani.ai Supported Voice options
const GNANI_VOICES = [
  { id: "Nalini", label: "Nalini (Female - Clear & Fluent)", gender: "Female" },
  { id: "Deepak", label: "Deepak (Male - Calm & Focused)", gender: "Male" },
  { id: "Radhika", label: "Radhika (Female - Warm & Friendly)", gender: "Female" },
  { id: "Kartik", label: "Kartik (Male - Energetic & Youthful)", gender: "Male" },
  { id: "Bhavna", label: "Bhavna (Female - Professional)", gender: "Female" },
  { id: "Pranav", label: "Pranav (Male - Expressive)", gender: "Male" },
  { id: "Yashvi", label: "Yashvi (Female - Crisp)", gender: "Female" },
  { id: "Gaurav", label: "Gaurav (Male - Deep)", gender: "Male" },
];

const GNANI_LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi (हिन्दी)" },
  { code: "ta-IN", label: "Tamil (தமிழ்)" },
  { code: "te-IN", label: "Telugu (తెలుగు)" },
  { code: "kn-IN", label: "Kannada (ಕನ್ನಡ)" },
  { code: "mr-IN", label: "Marathi (मराठी)" },
  { code: "bn-IN", label: "Bengali (বাংলা)" },
];

export default function WhiteboardTutorPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const aiSnapshotBoundsRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing state
  const [tool, setTool] = useState<"pen" | "eraser" | "selectErase">("pen");
  const [color, setColor] = useState("#1e293b"); // dark slate ink
  const [strokeWidth, setStrokeWidth] = useState(3.5);

  // Select-to-Erase Box Coordinates
  const [selectStart, setSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [selectCurrent, setSelectCurrent] = useState<{ x: number; y: number } | null>(null);

  // Voice & Speech Settings (Gnani.ai)
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Deepak");
  const [selectedLanguage, setSelectedLanguage] = useState("en-IN");
  const [speechSpeed, setSpeechSpeed] = useState(1.0);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  // AI & Voice state
  const [isListening, setIsListening] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState("");
  const [typedQuestion, setTypedQuestion] = useState("");
  const [tutorStatus, setTutorStatus] = useState<string>("Ready. Write math, click 'Guide Me', or speak.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastSpeechExplanation, setLastSpeechExplanation] = useState<string>("");
  const [tutorGuideHint, setTutorGuideHint] = useState<string | null>(null);

  // Tutor annotations & widgets
  const [errors, setErrors] = useState<ErrorAnnotation[]>([]);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Background worksheets / screenshots (MULTIPLE moveable & resizable photos)
  const [photos, setPhotos] = useState<AdjustablePhoto[]>([]);
  const [savedNotebooks, setSavedNotebooks] = useState<SavedNotebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState("");
  const [activeNotebookTitle, setActiveNotebookTitle] = useState("Notebook");
  const [notebooksOpen, setNotebooksOpen] = useState(false);
  const [notebookLoaded, setNotebookLoaded] = useState(false);
  const [notebookSaveTick, setNotebookSaveTick] = useState(0);
  const markNotebookDirty = () => setNotebookSaveTick((tick) => tick + 1);
  // Which photo (id) is currently selected (dashed frame + move/resize handles).
  // Writing on the canvas deselects it, fixing its position so strokes never nudge it.
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(null);
  const nextPhotoIdRef = useRef(1);

  // Place uploads in the visible workspace, preferring an open area near its center.
  const buildPhotoAtPointer = (
    src: string,
    img: HTMLImageElement
  ): AdjustablePhoto => {
    const aspectRatio = img.width / img.height;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const view = container?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const viewW = container?.clientWidth ?? 900;
    const viewH = container?.clientHeight ?? 700;
    const initW = Math.max(120, Math.min(img.width, 520, viewW * 0.82, viewH * 0.68 * aspectRatio));
    const initH = Math.round(initW / aspectRatio);

    const scaleX = canvas && canvasRect ? canvas.width / canvasRect.width : 1;
    const scaleY = canvas && canvasRect ? canvas.height / canvasRect.height : 1;
    const centerX = view && canvasRect ? (view.left + container!.clientWidth / 2 - canvasRect.left) * scaleX : canvasDimensions.width / 2;
    const centerY = view && canvasRect ? (view.top + container!.clientHeight / 2 - canvasRect.top) * scaleY : canvasDimensions.height / 2;
    const pad = 24;
    const candidates = [
      { x: centerX - initW / 2, y: centerY - initH / 2 },
      { x: centerX - initW / 2, y: centerY - initH - pad },
      { x: centerX - initW / 2, y: centerY + pad },
      { x: centerX - initW - pad, y: centerY - initH / 2 },
      { x: centerX + pad, y: centerY - initH / 2 },
    ].map((p) => ({
      x: clampNumber(Math.round(p.x), 10, canvasDimensions.width - initW - 20),
      y: clampNumber(Math.round(p.y), 10, canvasDimensions.height - initH - 20),
    }));

    const inkContext = canvas?.getContext("2d", { willReadFrequently: true });
    const ink = canvas && inkContext ? inkContext.getImageData(0, 0, canvas.width, canvas.height).data : null;
    const overlapsInk = (x: number, y: number) => {
      if (!canvas || !ink) return false;
      for (let py = Math.floor(y + 12); py < Math.min(y + initH - 12, canvas.height); py += 18) {
        for (let px = Math.floor(x + 12); px < Math.min(x + initW - 12, canvas.width); px += 18) {
          if (ink[(py * canvas.width + px) * 4 + 3] > 8) return true;
        }
      }
      return false;
    };
    const overlapsPhoto = (x: number, y: number) => photos.some((p) =>
      x < p.x + p.width && x + initW > p.x && y < p.y + p.height && y + initH > p.y
    );
    const chosen = candidates.find((p) => !overlapsInk(p.x, p.y) && !overlapsPhoto(p.x, p.y)) ?? candidates[0];

    return {
      id: nextPhotoIdRef.current++,
      src,
      img,
      x: chosen.x,
      y: chosen.y,
      width: initW,
      height: initH,
      aspectRatio,
    };
  };

  // Notebook theme (light / dark paper & UI chrome)
  const [notebookTheme, setNotebookTheme] = useState<"light" | "dark">("light");
  const isDark = notebookTheme === "dark";
  const drawingColor = isDark && color === "#1e293b" ? "#ffffff" : color;

  // Recolor existing neutral ink when the paper theme changes. Saturated pen colors stay intact.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      // The default slate ink (#1e293b) spans 29 RGB levels, so allow enough
      // tolerance to catch it and its anti-aliased edge pixels.
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 48;

      if (isDark && neutral && Math.max(red, green, blue) < 150) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      } else if (!isDark && neutral && Math.min(red, green, blue) > 225) {
        pixels[i] = 30;
        pixels[i + 1] = 41;
        pixels[i + 2] = 59;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [isDark]);

  // Extendable Canvas Dimensions (large virtual sheet that user can scroll and extend)
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 1800,
    height: 2600,
  });

  // Audio element reference & speech recognition
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const speechDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const isListeningRef = useRef(false); // Mirror isListening for closures
  const fallbackModeRef = useRef(false);
  const fallbackRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackStreamRef = useRef<MediaStream | null>(null);
  const fallbackChunksRef = useRef<Blob[]>([]);

  // Mic failure tracking (prevents infinite network-error restart loop)
  const micNetworkFailureRef = useRef(false);
  const micNetworkToastShownRef = useRef(false);

  // Drawing loop refs — driven directly by pointer events, not React state,
  // to avoid re-render lag and produce smooth continuous strokes
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const prevMidRef = useRef<{ x: number; y: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Resize canvas safely while preserving all handwritten ink
  const resizeCanvas = useCallback((width: number, height: number) => {
    if (!canvasRef.current || !overlayCanvasRef.current || width <= 0 || height <= 0) return;

    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;

    if (canvas.width === width && canvas.height === height) return;

    // Snapshot existing strokes to preserve them
    const temp = document.createElement("canvas");
    temp.width = canvas.width;
    temp.height = canvas.height;
    const tempCtx = temp.getContext("2d");
    if (tempCtx && canvas.width > 0 && canvas.height > 0) {
      tempCtx.drawImage(canvas, 0, 0);
    }

    // Set new pixel resolution
    canvas.width = width;
    canvas.height = height;
    overlay.width = width;
    overlay.height = height;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (temp.width > 0 && temp.height > 0) {
        ctx.drawImage(temp, 0, 0);
      }
    }

    setCanvasDimensions({ width, height });
  }, []);

  // Initialize canvas size on mount (large virtual notebook)
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
    const initialW = Math.max(window.innerWidth || 1200, isMobile ? 360 : 1800);
    const initialH = Math.max((window.innerHeight || 800) * 2.5, 2600);
    resizeCanvas(initialW, initialH);
  }, [resizeCanvas]);

  // ---------------- UNDO / REDO HISTORY (canvas snapshot based) ----------------
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const MAX_HISTORY = 25;

  const refreshHistoryState = () => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  };

  // Capture the current canvas as a compressed PNG snapshot
  const pushUndoSnapshot = () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      undoStackRef.current.push(dataUrl);
      if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
      // Any new action clears the redo timeline
      redoStackRef.current = [];
      refreshHistoryState();
    } catch {
      // ignore snapshot failures
    }
  };

  // Restore canvas from a snapshot (resizes canvas back to the snapshot's dimensions)
  const restoreSnapshot = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      if (canvas.width !== img.width || canvas.height !== img.height) {
        resizeCanvas(img.width, img.height);
      }

      const freshCanvas = canvasRef.current;
      const freshCtx = freshCanvas?.getContext("2d");
      if (!freshCanvas || !freshCtx) return;

      freshCtx.globalCompositeOperation = "source-over";
      freshCtx.clearRect(0, 0, freshCanvas.width, freshCanvas.height);
      freshCtx.drawImage(img, 0, 0);

      // AI annotations no longer apply to the restored content
      setErrors([]);
      setActiveHint(null);
      setTutorGuideHint(null);
      markNotebookDirty();
    };
    img.src = dataUrl;
  };

  const saveCurrentNotebook = async () => {
    const canvas = canvasRef.current;
    if (!activeNotebookId || !notebookLoaded || !canvas) return;
    try {
      const record: SavedNotebook = {
        id: activeNotebookId,
        title: activeNotebookTitle,
        updatedAt: Date.now(),
        width: canvas.width,
        height: canvas.height,
        ink: canvas.toDataURL("image/png"),
        photos: photos.map(({ img: _img, ...photo }) => photo),
      };
      await putSavedNotebook(record);
      setSavedNotebooks((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    } catch (error) {
      console.error("Notebook autosave failed:", error);
      showToast("Notebook could not be saved. Check available browser storage.");
    }
  };

  const loadNotebookData = async (notebook: SavedNotebook) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resizeCanvas(notebook.width, notebook.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (notebook.ink) {
      await new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => {
          ctx.drawImage(image, 0, 0);
          resolve();
        };
        image.onerror = () => resolve();
        image.src = notebook.ink;
      });
    }
    const restoredPhotos = await Promise.all(notebook.photos.map((photo) => new Promise<AdjustablePhoto | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ...photo, img });
      img.onerror = () => resolve(null);
      img.src = photo.src;
    })));
    setPhotos(restoredPhotos.filter((photo): photo is AdjustablePhoto => photo !== null));
    setSelectedPhotoId(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    refreshHistoryState();
    setErrors([]);
    setActiveHint(null);
    setTutorGuideHint(null);
    setGraphData(null);
    setSpeechTranscript("");
    setTypedQuestion("");
    setLastSpeechExplanation("");
    setTutorStatus(`${notebook.title} opened.`);
  };

  useEffect(() => {
    let cancelled = false;
    const initializeNotebooks = async () => {
      try {
        let records = await listSavedNotebooks();
        if (records.length === 0) {
          const canvas = canvasRef.current;
          const initial: SavedNotebook = {
            id: "notebook-default",
            title: "Notebook 1",
            updatedAt: Date.now(),
            width: canvas?.width || 1800,
            height: canvas?.height || 2600,
            ink: canvas?.toDataURL("image/png") || "",
            photos: photos.map(({ img: _img, ...photo }) => photo),
          };
          await putSavedNotebook(initial);
          records = [initial];
        }
        if (cancelled) return;
        const preferredId = localStorage.getItem("scribe-active-notebook");
        const active = records.find((record) => record.id === preferredId) ?? records.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setSavedNotebooks(records);
        setActiveNotebookId(active.id);
        setActiveNotebookTitle(active.title);
        await loadNotebookData(active);
        if (!cancelled) {
          localStorage.setItem("scribe-active-notebook", active.id);
          setNotebookLoaded(true);
        }
      } catch (error) {
        console.error("Could not open saved notebooks:", error);
        if (!cancelled) {
          setNotebookLoaded(true);
          showToast("Saved notebooks could not be loaded in this browser.");
        }
      }
    };
    void initializeNotebooks();
    return () => { cancelled = true; };
    // Load the saved notebook once after the canvas has been initialized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notebookLoaded || !activeNotebookId) return;
    const timer = window.setTimeout(() => { void saveCurrentNotebook(); }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNotebookId, activeNotebookTitle, notebookLoaded, notebookSaveTick, photos, canvasDimensions]);

  // Undo: take a redo snapshot of current state, then restore the last undo snapshot
  const undoLastStroke = () => {
    if (undoStackRef.current.length === 0) {
      showToast("Nothing to undo!");
      return;
    }
    const snapshot = undoStackRef.current.pop()!;
    try {
      if (canvasRef.current) {
        const current = canvasRef.current.toDataURL("image/png");
        redoStackRef.current.push(current);
      }
    } catch {
      // ignore
    }
    restoreSnapshot(snapshot);
    refreshHistoryState();
    showToast("Undo!");
  };

  // Redo: reverse the last undo
  const redoLastStroke = () => {
    if (redoStackRef.current.length === 0) {
      showToast("Nothing to redo!");
      return;
    }
    const snapshot = redoStackRef.current.pop()!;
    try {
      if (canvasRef.current) {
        const current = canvasRef.current.toDataURL("image/png");
        undoStackRef.current.push(current);
      }
    } catch {
      // ignore
    }
    restoreSnapshot(snapshot);
    refreshHistoryState();
    showToast("Redo!");
  };

  // Keyboard shortcuts: Ctrl+Z = Undo, Ctrl+Y / Ctrl+Shift+Z = Redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undoLastStroke();
        } else if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          redoLastStroke();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- AUTO-EXTEND NOTEBOOK ----------------
  // When the user scrolls within ~50px of the bottom or right edge,
  // automatically extend the notebook page in that direction.
  const autoExtendCooldownRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (autoExtendCooldownRef.current) return;

      const nearBottom =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
      const nearRight =
        container.scrollLeft + container.clientWidth >= container.scrollWidth - 50;

      if (!nearBottom && !nearRight) return;

      // Small cooldown so we don't extend on every scroll tick
      autoExtendCooldownRef.current = setTimeout(() => {
        autoExtendCooldownRef.current = null;
      }, 400);

      const newHeight = nearBottom ? canvasDimensions.height + 600 : canvasDimensions.height;
      const newWidth = nearRight ? canvasDimensions.width + 600 : canvasDimensions.width;
      resizeCanvas(Math.min(newWidth, 12000), Math.min(newHeight, 30000));
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [canvasDimensions, resizeCanvas]);

  // Photo Dragging Handlers (Move a specific photo anywhere on canvas)
  const handlePhotoDragStart = (e: React.PointerEvent, photoId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const target = photos.find((p) => p.id === photoId);
    if (!target) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = target.x;
    const initialY = target.y;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                x: clampNumber(initialX + dx, 10, canvasDimensions.width - p.width - 20),
                y: clampNumber(initialY + dy, 10, canvasDimensions.height - p.height - 20),
              }
            : p
        )
      );
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Photo Resizing Handlers (Drag bottom-right corner of one photo to scale)
  const handlePhotoResizeStart = (e: React.PointerEvent, photoId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const target = photos.find((p) => p.id === photoId);
    if (!target) return;

    const startX = e.clientX;
    const initialW = target.width;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      setPhotos((prev) =>
        prev.map((p) => {
          if (p.id !== photoId) return p;
          const newW = clampNumber(initialW + dx, 180, canvasDimensions.width - p.x - 20);
          const newH = Math.round(newW / p.aspectRatio);
          return { ...p, width: newW, height: newH };
        })
      );
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Photo Zoom button helper (one specific photo)
  const handlePhotoZoom = (photoId: number, factor: number) => {
    setPhotos((prev) =>
      prev.map((p) => {
        if (p.id !== photoId) return p;
        const newW = clampNumber(Math.round(p.width * factor), 180, canvasDimensions.width - p.x - 20);
        const newH = Math.round(newW / p.aspectRatio);
        return { ...p, width: newW, height: newH };
      })
    );
  };

  // Reset size button helper (one specific photo)
  const resetPhotoWidth = (photoId: number) => {
    setPhotos((prev) =>
      prev.map((p) => {
        if (p.id !== photoId) return p;
        const initW = Math.min(p.img.width, 520);
        return {
          ...p,
          width: initW,
          height: Math.round(initW / p.aspectRatio),
        };
      })
    );
  };

  // Remove one specific photo
  const removePhoto = (photoId: number) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    if (selectedPhotoId === photoId) setSelectedPhotoId(null);
  };

  // Support DIRECT SCREENSHOT PASTE (Ctrl+V) as an adjustable photo!
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = (event) => {
            const src = event.target?.result as string;
            const img = new Image();
            img.onload = () => {
              const newPhoto = buildPhotoAtPointer(src, img);
              // Only ONE photo selected at a time — the newest pasted one
              setPhotos((prev) => [...prev, newPhoto]);
              setSelectedPhotoId(newPhoto.id);
              showToast("Screenshot pasted at your pointer! Hold & drag it, use corner to resize.");
              setTutorStatus("Worksheet ready. Write anywhere — pasted images stay fixed while you write.");
            };
            img.src = src;
          };
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [canvasDimensions]);

  // Keep isListeningRef in sync with isListening state
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Speech Recognition builder — creates a FRESH, fully configured instance.
  // Called on init, when language changes, and on every "Mic On" click so a
  // dead/faulty browser instance can never leave the mic button unusable.
  const buildRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedLanguage === "en-IN" ? "en-IN" : selectedLanguage;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      micNetworkFailureRef.current = false;
      setIsListening(true);
      isListeningRef.current = true;
      setTutorStatus("🎤 Microphone listening... Speak your question.");
    };

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      const displayText = finalText || interimText;
      setSpeechTranscript(displayText);

      // Ultra-low latency: fire the moment the sentence ends (450ms pause)
      if (speechDebounceTimer.current) clearTimeout(speechDebounceTimer.current);

      if (finalText.trim().length > 3) {
        speechDebounceTimer.current = setTimeout(() => {
          voiceCommandRef.current(finalText.trim());
          setSpeechTranscript("");
        }, 450);
      } else if (interimText.trim().length > 3) {
        // Interim fallback while the engine hasn't finalized yet
        speechDebounceTimer.current = setTimeout(() => {
          voiceCommandRef.current(interimText.trim());
          setSpeechTranscript("");
        }, 1000);
      }
    };

    recognition.onerror = (err: any) => {
      if (err.error === "not-allowed" || err.error === "permission-denied") {
        setIsListening(false);
        isListeningRef.current = false;
        setTutorStatus("Microphone blocked. Please allow mic in browser address bar.");
        showToast("Microphone permission blocked. Click the 🔒 icon in the address bar → Allow microphone.");
      } else if (err.error === "no-speech") {
        // No speech detected — this is normal, just keep listening
      } else if (err.error === "aborted") {
        // User stopped the mic — nothing to do
      } else if (err.error === "network") {
        // The browser's remote speech service is unavailable. Switch to a
        // direct microphone recording that we transcribe through our API.
        micNetworkFailureRef.current = true;
        setIsListening(true);
        isListeningRef.current = true;
        setTutorStatus("Browser voice service unavailable. Switching to mic recording…");
        if (!micNetworkToastShownRef.current) {
          micNetworkToastShownRef.current = true;
          showToast("Browser voice service is unavailable. Speak, then tap the mic again to send your question.");
        }
        void startMicRecordingFallback();
      } else if (err.error === "language-not-supported") {
        micNetworkFailureRef.current = true;
        setIsListening(false);
        isListeningRef.current = false;
        setTutorStatus("This speech language isn't supported by the browser. Switch to English in Voice settings.");
        showToast("🎤 Language not supported by the browser's speech engine — try English.");
      }
    };

    recognition.onend = () => {
      // Auto-restart only if user still wants listening active AND last attempt
      // did not fail with a network error (otherwise it loops forever)
      if (isListeningRef.current && !micNetworkFailureRef.current) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // ignore double-start, handled by fresh instance on next toggle
          }
        }, 250);
      }
    };

    return recognition;
  }, [selectedLanguage]);

  // Initialize recognition once (and rebuild when the language setting changes)
  useEffect(() => {
    const recognition = buildRecognition();
    recognitionRef.current = recognition;
    return () => {
      try {
        recognition?.stop();
      } catch {
        // ignore
      }
    };
  }, [buildRecognition]);

  const startMicRecordingFallback = async () => {
    if (fallbackModeRef.current) return;
    fallbackModeRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isListeningRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        fallbackModeRef.current = false;
        return;
      }
      fallbackStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      fallbackRecorderRef.current = recorder;
      fallbackChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) fallbackChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const audio = new Blob(fallbackChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        fallbackChunksRef.current = [];
        fallbackStreamRef.current?.getTracks().forEach((track) => track.stop());
        fallbackStreamRef.current = null;
        fallbackRecorderRef.current = null;
        fallbackModeRef.current = false;
        if (audio.size < 1000) {
          setTutorStatus("I didn’t get enough audio. Tap the mic and try again.");
          return;
        }

        setTutorStatus("Transcribing your question…");
        try {
          const form = new FormData();
          form.append("audio", audio, "question.webm");
          form.append("language", selectedLanguage);
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Transcription failed");
          const transcript = String(result.transcript || "").trim();
          if (!transcript) {
            setTutorStatus("I couldn’t hear a clear question. Tap the mic and try again.");
            return;
          }
          setSpeechTranscript(transcript);
          setTutorStatus(`Heard: “${transcript}”`);
          voiceCommandRef.current(transcript);
        } catch (error) {
          console.error("Mic transcription failed:", error);
          setTutorStatus("Voice transcription failed. Please try again or use Ask.");
          showToast("Couldn’t transcribe that recording. Try the mic again.");
        }
      };
      recorder.start();
      setTutorStatus("🎤 Recording. Tap the mic again when you finish speaking.");
    } catch (error) {
      console.error("Could not start microphone recording fallback:", error);
      fallbackModeRef.current = false;
      fallbackStreamRef.current?.getTracks().forEach((track) => track.stop());
      fallbackStreamRef.current = null;
      setIsListening(false);
      isListeningRef.current = false;
      setTutorStatus("Microphone access failed. Allow mic access in your browser, then try again.");
      showToast("Could not access the microphone. Check browser microphone permission.");
    }
  };

  const stopMicRecordingFallback = () => {
    setIsListening(false);
    isListeningRef.current = false;
    const recorder = fallbackRecorderRef.current;
    if (recorder?.state === "recording") {
      setTutorStatus("Sending your recording for transcription…");
      recorder.stop();
    } else {
      fallbackModeRef.current = false;
      fallbackStreamRef.current?.getTracks().forEach((track) => track.stop());
      fallbackStreamRef.current = null;
    }
  };

  // Toggle Microphone Listener safely
  const toggleListening = () => {
    if (fallbackModeRef.current) {
      stopMicRecordingFallback();
      return;
    }
    if (isListening) {
      // STOP listening
      setIsListening(false);
      isListeningRef.current = false;
      if (speechDebounceTimer.current) clearTimeout(speechDebounceTimer.current);
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setSpeechTranscript("");
      setTutorStatus("Microphone paused.");
      showToast("🎤 Microphone OFF");
    } else {
      // START listening — always build a FRESH instance so a dead recognition
      // object from a previous failed session can never block the mic again
      micNetworkFailureRef.current = false;
      const freshRecognition = buildRecognition();
      if (!freshRecognition) {
        alert("Speech recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.");
        return;
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = freshRecognition;
      try {
        freshRecognition.start();
        setIsListening(true);
        isListeningRef.current = true;
        setTutorStatus("🎤 Microphone active. Say: 'Solve question 1' or 'Guide me'...");
        showToast("🎤 Microphone ON — Speak your question!");
      } catch {
        showToast("Failed to start microphone. Check browser mic permission and try again.");
      }
    }
  };

  // Use Gnani.ai as the sole speech output so the selected voice is always honored.
  const playGnaniSpeech = async (text: string, overrideVoice?: string, overrideLang?: string) => {
    if (!soundEnabled || !text || text.trim() === "") return;

    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      setIsPlayingAudio(true);
      setTutorStatus(`Speaking via Gnani.ai (${overrideVoice || selectedVoice})...`);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language: overrideLang || selectedLanguage,
          voice: overrideVoice || selectedVoice,
          speed: speechSpeed,
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Gnani TTS ${res.status}: ${detail}`);
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsPlayingAudio(false);
        setTutorStatus("Ready.");
      };

      await audio.play();
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsPlayingAudio(false);
      setTutorStatus("Gnani.ai voice unavailable. Check the TTS settings and try Replay.");
      showToast("Gnani.ai could not generate audio. The response is still available to read.");
    }
  };

  // Test current selected voice
  const testCurrentVoice = async () => {
    setIsTestingVoice(true);
    const sampleText =
      selectedLanguage === "hi-IN"
        ? "नमस्ते, मैं आपका गणित शिक्षक हूँ। गनानी ए आई वाणी तैयार है।"
        : `Hello, I am speaking with Gnani AI ${selectedVoice} voice. Ready to guide your math.`;
    await playGnaniSpeech(sampleText);
    setIsTestingVoice(false);
  };

  // Redraw Error Overlines, Overlays & Selection Box
  const renderOverlay = useCallback(() => {
    if (!overlayCanvasRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Select-to-Erase Box (if dragging)
    if (tool === "selectErase" && selectStart && selectCurrent) {
      const x = Math.min(selectStart.x, selectCurrent.x);
      const y = Math.min(selectStart.y, selectCurrent.y);
      const w = Math.abs(selectCurrent.x - selectStart.x);
      const h = Math.abs(selectCurrent.y - selectStart.y);

      ctx.save();
      ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("Release to erase area", x + 6, Math.max(y - 6, 15));
      ctx.restore();
    }

    // 2. Draw Error Underlines
    errors.forEach((err) => {
      const [ymin, xmin, ymax, xmax] = err.box_2d || [240, 100, 290, 260];
      const bounds = aiSnapshotBoundsRef.current ?? {
        left: 0,
        top: 0,
        width: canvas.width,
        height: canvas.height,
      };
      const x1 = bounds.left + (xmin / 1000) * bounds.width;
      const y1 = bounds.top + (ymin / 1000) * bounds.height;
      const x2 = bounds.left + (xmax / 1000) * bounds.width;
      const y2 = bounds.top + (ymax / 1000) * bounds.height;

      const lineY = Math.min(y2 + 4, canvas.height - 10);
      ctx.save();
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 3.5;
      ctx.beginPath();

      const width = Math.max(x2 - x1, 40);
      const startX = Math.max(x1 - 5, 10);
      for (let x = 0; x <= width; x += 2) {
        const yOffset = Math.sin((x / 12) * Math.PI * 2) * 4;
        if (x === 0) ctx.moveTo(startX + x, lineY + yOffset);
        else ctx.lineTo(startX + x, lineY + yOffset);
      }
      ctx.stroke();

      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(startX + width + 10, lineY - 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", startX + width + 10, lineY - 2);

      ctx.restore();
    });
  }, [errors, tool, selectStart, selectCurrent]);

  useEffect(() => {
    renderOverlay();
  }, [renderOverlay]);

  // Export only the meaningful notebook area so writing is legible to vision models.
  // The virtual sheet can be much larger than the student's actual work.
  const getCanvasSnapshot = (): string | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    if (canvas.width <= 10 || canvas.height <= 10) return null;

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    // Handwriting is transparent on the canvas; find its visible pixel bounds.
    const inkContext = canvas.getContext("2d", { willReadFrequently: true });
    if (inkContext) {
      const pixels = inkContext.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] <= 12) continue;
        const pixel = (i - 3) / 4;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    // Include uploaded worksheets even when they have no writing over them.
    photos.forEach((photo) => {
      minX = Math.min(minX, photo.x);
      minY = Math.min(minY, photo.y);
      maxX = Math.max(maxX, photo.x + photo.width);
      maxY = Math.max(maxY, photo.y + photo.height);
    });

    if (minX >= canvas.width || minY >= canvas.height || maxX <= minX || maxY <= minY) {
      minX = 0;
      minY = 0;
      maxX = canvas.width;
      maxY = canvas.height;
    }

    const margin = 72;
    const left = Math.max(0, Math.floor(minX - margin));
    const top = Math.max(0, Math.floor(minY - margin));
    const right = Math.min(canvas.width, Math.ceil(maxX + margin));
    const bottom = Math.min(canvas.height, Math.ceil(maxY + margin));
    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    const scale = Math.min(3, 1800 / Math.max(sourceWidth, sourceHeight));
    aiSnapshotBoundsRef.current = { left, top, width: sourceWidth, height: sourceHeight };

    const snapshot = document.createElement("canvas");
    snapshot.width = Math.max(1, Math.round(sourceWidth * scale));
    snapshot.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = snapshot.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
    ctx.fillRect(0, 0, snapshot.width, snapshot.height);
    photos.forEach((photo) => {
      if (!photo.img) return;
      try {
        ctx.drawImage(
          photo.img,
          (photo.x - left) * scale,
          (photo.y - top) * scale,
          photo.width * scale,
          photo.height * scale
        );
      } catch (err) {
        console.warn("Could not draw photo onto snapshot:", err);
      }
    });
    ctx.drawImage(
      canvas,
      -left * scale,
      -top * scale,
      canvas.width * scale,
      canvas.height * scale
    );

    return snapshot.toDataURL("image/jpeg", 0.92);
  };

  // SMART PLACEMENT: Scan canvas pixels to find safe blank area
  // Intelligently respects the position and size of the moveable photo!
  const findNextPlacementPosition = (canvas: HTMLCanvasElement): { x: number; y: number } => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return { x: 540, y: 150 };

    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

    // Normal freehand whiteboard placement (photos are checked afterwards):
    let maxY = 100;
    let minX = canvas.width;
    let maxX = 0;
    let found = false;

    for (let y = canvas.height - 1; y >= 50; y -= 6) {
      for (let x = 40; x < canvas.width - 40; x += 6) {
        const alpha = data[(y * canvas.width + x) * 4 + 3];
        if (alpha > 40) {
          if (!found) {
            maxY = y;
            found = true;
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    // Target just below the lowest ink, at a sensible horizontal start
    let targetX = Math.max(minX > 0 && minX < canvas.width ? minX : 100, 80);
    let targetY = maxY + 55;

    // Photos: push the writing target below any photo overlapping that column
    photos.forEach((p) => {
      const overlapsColumn = targetX + 320 > p.x && targetX < p.x + p.width + 40;
      const photoBottom = p.y + p.height + 60;
      if (overlapsColumn && photoBottom > targetY && p.y < targetY + 40) {
        targetY = photoBottom;
      }
    });

    if (targetY > canvas.height - 250) {
      return {
        x: Math.min(maxX + 60, canvas.width - 320),
        y: targetY < canvas.height - 250 ? targetY : 180,
      };
    }

    return { x: targetX, y: targetY };
    } catch {
      return { x: 540, y: 150 };
    }
  };

  // HANDWRITING RENDERER: Renders math solution in natural handwriting style font
  // Automatically extends canvas height if more space is needed!
  const writeAutocompleteToCanvas = (lines: string[] | string) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lineArray: string[] = [];
    if (Array.isArray(lines)) {
      lines.forEach((l) => {
        if (l && l.trim()) lineArray.push(...l.split("\n"));
      });
    } else if (typeof lines === "string") {
      lineArray = lines.split(/\n+/).filter((l) => l.trim().length > 0);
    }

    const finalLines: string[] = [];
    lineArray.forEach((raw) => {
      if (raw.length > 38) {
        const words = raw.split(" ");
        let cur = "";
        words.forEach((w) => {
          if ((cur + " " + w).length > 34) {
            finalLines.push(cur);
            cur = w;
          } else {
            cur = cur ? cur + " " + w : w;
          }
        });
        if (cur) finalLines.push(cur);
      } else {
        finalLines.push(raw);
      }
    });

    const { x: startX, y: startY } = findNextPlacementPosition(canvas);

    pushUndoSnapshot();

    // Auto-extend canvas if solution will go beyond bottom
    const lineHeight = 44;
    const requiredHeight = startY + finalLines.length * lineHeight + 200;
    if (requiredHeight > canvas.height) {
      resizeCanvas(canvas.width, requiredHeight + 600);
    }

    ctx.save();
    ctx.font = "bold 34px 'Caveat', 'Kalam', cursive, sans-serif";
    ctx.fillStyle = drawingColor; // Keep the default ink visible in both notebook themes.
    ctx.textBaseline = "alphabetic";

    let currentY = startY;

    finalLines.forEach((line) => {
      ctx.fillText(line, startX, currentY);
      currentY += lineHeight;
    });

    ctx.restore();
    markNotebookDirty();
    showToast("Solution written on canvas in handwriting!");
  };

  const draw2DGraphOnCanvas = (expression: string, title: string, xMin?: number, xMax?: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const fn = compile2DGraph(expression);
    if (!canvas || !ctx || !fn) {
      showToast("I couldn't read that graph equation. Try a function such as y = x^2.");
      return false;
    }

    const plotWidth = Math.min(560, canvas.width - 80);
    const plotHeight = 380;
    const position = findNextPlacementPosition(canvas);
    const plotX = clampNumber(position.x, 12, Math.max(12, canvas.width - plotWidth - 12));
    const plotY = position.y;
    if (plotY + plotHeight + 40 > canvas.height) resizeCanvas(canvas.width, plotY + plotHeight + 240);

    const minX = Number.isFinite(xMin) ? xMin! : -5;
    const maxX = Number.isFinite(xMax) && xMax! > minX ? xMax! : 5;
    const plotColor = isDark ? "#fbbf24" : "#7c3aed";
    const samples = 240;
    const values = Array.from({ length: samples + 1 }, (_, i) => {
      const x = minX + ((maxX - minX) * i) / samples;
      return { x, y: fn(x) };
    });
    const finiteY = values.map((p) => p.y).filter((y) => Number.isFinite(y) && Math.abs(y) < 1e6);
    if (finiteY.length < samples * 0.1) {
      showToast("That graph has too few visible points to draw. Try a different x range.");
      return false;
    }
    let minY = Math.min(...finiteY);
    let maxY = Math.max(...finiteY);
    if (maxY - minY < 1e-6) {
      minY -= 1;
      maxY += 1;
    } else {
      const padding = (maxY - minY) * 0.12;
      minY -= padding;
      maxY += padding;
    }

    pushUndoSnapshot();
    const left = plotX + 58;
    const right = plotX + plotWidth - 18;
    const top = plotY + 42;
    const bottom = plotY + plotHeight - 42;
    const mapX = (x: number) => left + ((x - minX) / (maxX - minX)) * (right - left);
    const mapY = (y: number) => bottom - ((y - minY) / (maxY - minY)) * (bottom - top);

    ctx.save();
    // Give the graph its own paper surface so the notebook grid cannot show
    // through and visually merge with the graph's internal grid.
    ctx.fillStyle = isDark ? "#0f172a" : "#ffffff";
    ctx.fillRect(plotX, plotY, plotWidth, plotHeight);
    ctx.strokeStyle = isDark ? "#475569" : "#c4b5fd";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plotX, plotY, plotWidth, plotHeight);

    ctx.font = "bold 25px 'Caveat', 'Kalam', cursive, sans-serif";
    ctx.fillStyle = plotColor;
    ctx.textBaseline = "middle";
    ctx.fillText(title || `y = ${expression}`, plotX + 8, plotY + 20);
    ctx.font = "14px 'Kalam', sans-serif";
    ctx.lineWidth = 1;
    ctx.strokeStyle = isDark ? "rgba(251,191,36,0.28)" : "rgba(124,58,237,0.24)";
    ctx.fillStyle = isDark ? "#cbd5e1" : "#475569";

    for (let i = 0; i <= 10; i++) {
      const gx = left + ((right - left) * i) / 10;
      const gy = top + ((bottom - top) * i) / 10;
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(right, gy); ctx.stroke();
      const xv = minX + ((maxX - minX) * i) / 10;
      const yv = maxY - ((maxY - minY) * i) / 10;
      ctx.fillText(xv.toFixed(1).replace(/\.0$/, ""), gx - 8, bottom + 18);
      ctx.fillText(yv.toFixed(1).replace(/\.0$/, ""), left - 34, gy);
    }

    if (minY <= 0 && maxY >= 0) {
      ctx.strokeStyle = isDark ? "#f8fafc" : "#1e293b";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(left, mapY(0)); ctx.lineTo(right, mapY(0)); ctx.stroke();
    }
    if (minX <= 0 && maxX >= 0) {
      ctx.strokeStyle = isDark ? "#f8fafc" : "#1e293b";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mapX(0), top); ctx.lineTo(mapX(0), bottom); ctx.stroke();
    }

    ctx.strokeStyle = plotColor;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let drawing = false;
    let previousY = Number.NaN;
    values.forEach(({ x, y }) => {
      if (!Number.isFinite(y) || Math.abs(y) >= 1e6) {
        drawing = false;
        previousY = Number.NaN;
        return;
      }
      const px = mapX(x);
      const py = mapY(y);
      if (!drawing || Math.abs(py - previousY) > plotHeight * 0.45) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      drawing = true;
      previousY = py;
    });
    ctx.stroke();
    ctx.restore();

    markNotebookDirty();
    showToast("2D graph added to the notebook. Use Undo to remove it.");
    return true;
  };

  // Main Tutor Analysis & Guidance Pipeline
  const runTutorAnalysis = async (
    userQuery: string = "",
    mode: "check" | "guide" | "autocomplete" | "interact" = "check",
    overrideImage?: string
  ) => {
    if (isAnalyzing) return;

    const board = canvasRef.current;
    const boardContext = board?.getContext("2d", { willReadFrequently: true });
    let hasInk = false;
    if (board && boardContext) {
      const { data } = boardContext.getImageData(0, 0, board.width, board.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) {
          hasInk = true;
          break;
        }
      }
    }
    if (mode === "check" && !hasInk) {
      setTutorStatus("Write your solution on the board before asking me to check it.");
      showToast("Check needs your written attempt first.");
      return;
    }
    if (!hasInk && photos.length === 0) {
      setTutorStatus("The notebook is empty. Write something or upload a worksheet first.");
      showToast("Nothing on the board yet — write or upload a worksheet first.");
      return;
    }

    const imageBase64 = overrideImage || getCanvasSnapshot();
    if (!imageBase64) {
      setTutorStatus("Notebook is empty. Write an equation or paste a screenshot first.");
      showToast("Please write or paste something on the canvas first!");
      return;
    }

    setIsAnalyzing(true);
    if (userQuery) {
      setTutorStatus(`Solving: "${userQuery}"...`);
    } else if (mode === "guide") {
      setTutorStatus("Tutor is thinking... Preparing your guidance...");
    } else if (mode === "autocomplete") {
      setTutorStatus("Solving and writing solution in handwriting...");
    } else {
      setTutorStatus("Evaluating math steps with Gemini...");
    }

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageBase64,
          userQuery: userQuery,
          mode: mode,
          language: selectedLanguage,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Tutor API error ${res.status}: ${errText}`);
      }

      const data = await res.json();

      // 1. Errors & Underlines
      if (data.hasError && data.errors && data.errors.length > 0) {
        setErrors(data.errors);
        setActiveHint(data.errors[0]?.hint || "Calculation error detected.");
      } else {
        setErrors([]);
        setActiveHint(null);
      }

      // 2. Guide hint display
      if (mode === "guide" || userQuery.toLowerCase().includes("stuck") || userQuery.toLowerCase().includes("help")) {
        setTutorGuideHint(data.speechExplanation);
      }

      // 3. Autocomplete onto canvas in HANDWRITING format
      // Checking only verifies existing work; it must never write an answer.
      if (mode !== "guide" && mode !== "check" && data.autocomplete?.needed) {
        const steps = data.autocomplete.steps || (data.autocomplete.text ? [data.autocomplete.text] : []);
        if (steps.length > 0) {
          writeAutocompleteToCanvas([steps[0]]); // ONE step only, never the whole answer
        }
      }

      // 4. Draw ordinary 2D functions directly on the writing canvas.
      // Keep surfaces and explicit 3D requests in the existing interactive graph card.
      if (data.graphWidget?.needed && data.graphWidget?.function) {
        const isSurface = /\by\b/i.test(data.graphWidget.function);
        const requested3D = /\b3\s*d\b/i.test(userQuery);
        if (isSurface || requested3D) {
          setGraphData(data.graphWidget);
        } else {
          draw2DGraphOnCanvas(
            data.graphWidget.function,
            data.graphWidget.title,
            data.graphWidget.xMin,
            data.graphWidget.xMax
          );
        }
      }

      // 5. Voice Tutor Response via Gnani.ai — fire immediately (no await)
      if (data.speechExplanation) {
        setLastSpeechExplanation(data.speechExplanation);
        playGnaniSpeech(data.speechExplanation);
      } else {
        setTutorStatus("Step verified.");
      }
    } catch (err: any) {
      console.error("Analysis failure:", err);
      setTutorStatus("Error reaching tutor. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Pointer & Drawing handlers with exact coordinate scaling
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (tool === "selectErase") {
      pushUndoSnapshot();
      setSelectedPhotoId(null); // Writing/erasing deselects & fixes all photos
      setSelectStart({ x, y });
      setSelectCurrent({ x, y });
      return;
    }

    pushUndoSnapshot();
    setSelectedPhotoId(null); // Writing/erasing deselects & fixes all photos
    isDrawingRef.current = true;
    lastPointRef.current = { x, y };
    prevMidRef.current = null;

    // Draw a small round dot instantly so single taps leave visible ink
    if (tool === "pen") {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.fillStyle = drawingColor;
        ctx.beginPath();
        ctx.arc(x, y, strokeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (tool === "selectErase") {
      if (selectStart) {
        const rectX = (e.clientX - rect.left) * scaleX;
        const rectY = (e.clientY - rect.top) * scaleY;
        setSelectCurrent({ x: rectX, y: rectY });
      }
      return;
    }

    if (!isDrawingRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "eraser") {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = strokeWidth * 6;
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = strokeWidth;
      ctx.globalCompositeOperation = "source-over";
    }

    // Use high-frequency coalesced pointer events so fast strokes stay smooth
    const native = e.nativeEvent as PointerEvent;
    const events =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const points = events.length > 0 ? events : [native];

    points.forEach((evt) => {
      const px = (evt.clientX - rect.left) * scaleX;
      const py = (evt.clientY - rect.top) * scaleY;
      const last = lastPointRef.current;
      const prevMid = prevMidRef.current;
      if (!last) return;

      // Quadratic midpoint smoothing: curve through the midpoint between
      // the last two input points, turning sharp lineTo corners into arcs
      const midX = (last.x + px) / 2;
      const midY = (last.y + py) / 2;

      if (prevMid) {
        ctx.beginPath();
        ctx.moveTo(prevMid.x, prevMid.y);
        ctx.quadraticCurveTo(last.x, last.y, midX, midY);
        ctx.stroke();
      }

      prevMidRef.current = { x: midX, y: midY };
      lastPointRef.current = { x: px, y: py };
    });
  };

  const stopDrawing = () => {
    if (isDrawingRef.current && prevMidRef.current && lastPointRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = strokeWidth;
        // Taper the end of the stroke with a final curve through the last point
        const last = lastPointRef.current;
        ctx.beginPath();
        ctx.moveTo(prevMidRef.current.x, prevMidRef.current.y);
        ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
        ctx.stroke();
      }
    }

    if (tool === "selectErase" && selectStart && selectCurrent && canvasRef.current) {
      const x = Math.min(selectStart.x, selectCurrent.x);
      const y = Math.min(selectStart.y, selectCurrent.y);
      const w = Math.abs(selectCurrent.x - selectStart.x);
      const h = Math.abs(selectCurrent.y - selectStart.y);

      if (w > 5 && h > 5) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          ctx.clearRect(x, y, w, h);
          showToast(`Erased selected area (${Math.round(w)}×${Math.round(h)}px)`);
        }
      }

      setSelectStart(null);
      setSelectCurrent(null);
      renderOverlay();
      isDrawingRef.current = false;
      lastPointRef.current = null;
      prevMidRef.current = null;
      markNotebookDirty();
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    prevMidRef.current = null;
    markNotebookDirty();
  };

  // FULL CLEAR NOTEBOOK: removes all text, equations, photo, and errors from notebook
  const clearAllTextFromNotebook = () => {
    pushUndoSnapshot();
    if (!canvasRef.current || !overlayCanvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const overlayCtx = overlayCanvasRef.current.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    setPhotos([]);
    setSelectedPhotoId(null);
    setErrors([]);
    setActiveHint(null);
    setTutorGuideHint(null);
    setGraphData(null);
    setSpeechTranscript("");
    setTypedQuestion("");
    setLastSpeechExplanation("");
    setTutorStatus("Notebook cleared. Ready for new problem.");
    showToast("Notebook completely cleared!");
    markNotebookDirty();
  };

  const createNewNotebook = async () => {
    await saveCurrentNotebook();
    const notebook: SavedNotebook = {
      id: crypto.randomUUID(),
      title: `Notebook ${savedNotebooks.length + 1}`,
      updatedAt: Date.now(),
      width: canvasRef.current?.width || canvasDimensions.width,
      height: canvasRef.current?.height || canvasDimensions.height,
      ink: "",
      photos: [],
    };
    await putSavedNotebook(notebook);
    setNotebookLoaded(false);
    setActiveNotebookId(notebook.id);
    setActiveNotebookTitle(notebook.title);
    localStorage.setItem("scribe-active-notebook", notebook.id);
    await loadNotebookData(notebook);
    setSavedNotebooks((current) => [notebook, ...current]);
    setNotebookLoaded(true);
    setNotebooksOpen(false);
    setTutorStatus("New notebook ready.");
    showToast("Started a new notebook. Your previous one is saved.");
  };

  const switchNotebook = async (notebook: SavedNotebook) => {
    if (notebook.id === activeNotebookId) {
      setNotebooksOpen(false);
      return;
    }
    await saveCurrentNotebook();
    setNotebookLoaded(false);
    setActiveNotebookId(notebook.id);
    setActiveNotebookTitle(notebook.title);
    localStorage.setItem("scribe-active-notebook", notebook.id);
    await loadNotebookData(notebook);
    setNotebookLoaded(true);
    setNotebooksOpen(false);
    setTutorStatus(`${notebook.title} opened.`);
  };

  const removeNotebook = async (notebook: SavedNotebook) => {
    if (!window.confirm(`Delete “${notebook.title}” permanently? This cannot be undone.`)) return;

    const deletingActiveNotebook = notebook.id === activeNotebookId;
    if (deletingActiveNotebook) setNotebookLoaded(false);
    try {
      await deleteSavedNotebook(notebook.id);
      const remaining = savedNotebooks.filter((item) => item.id !== notebook.id);
      setSavedNotebooks(remaining);

      if (deletingActiveNotebook) {
        const nextNotebook = remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (nextNotebook) {
          setActiveNotebookId(nextNotebook.id);
          setActiveNotebookTitle(nextNotebook.title);
          localStorage.setItem("scribe-active-notebook", nextNotebook.id);
          await loadNotebookData(nextNotebook);
        } else {
          const replacement: SavedNotebook = {
            id: crypto.randomUUID(),
            title: "Notebook 1",
            updatedAt: Date.now(),
            width: canvasRef.current?.width || canvasDimensions.width,
            height: canvasRef.current?.height || canvasDimensions.height,
            ink: "",
            photos: [],
          };
          await putSavedNotebook(replacement);
          setSavedNotebooks([replacement]);
          setActiveNotebookId(replacement.id);
          setActiveNotebookTitle(replacement.title);
          localStorage.setItem("scribe-active-notebook", replacement.id);
          await loadNotebookData(replacement);
        }
        setNotebookLoaded(true);
      }
      showToast(`Deleted ${notebook.title}.`);
    } catch (error) {
      console.error("Could not delete notebook:", error);
      if (deletingActiveNotebook) setNotebookLoaded(true);
      showToast("Notebook could not be deleted. Please try again.");
    }
  };

  // Voice Command Trigger
  const handleVoiceCommand = (command: string) => {
    if (!command || command.trim() === "") return;
    const lower = command.toLowerCase();

    if (lower.includes("clear") && (lower.includes("all") || lower.includes("notebook") || lower.includes("canvas"))) {
      clearAllTextFromNotebook();
    } else {
      // Undo / redo / pass-through voice commands
      if (lower.includes("undo")) {
        undoLastStroke();
        return;
      }
      if (lower.includes("redo")) {
        redoLastStroke();
        return;
      }
      // Pass the voice query directly to the tutor!
      runTutorAnalysis(command, "interact");
    }
  };

  // Keep a fresh ref so SpeechRecognition closures always call the latest handler
  // (avoids stale state like isAnalyzing / photo shortcuts breaking voice commands)
  const voiceCommandRef = useRef<(cmd: string) => void>(() => {});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- ref sync after render is intentional
    voiceCommandRef.current = handleVoiceCommand;
  });

  // Upload problem sheet / worksheet image as moveable, resizable photo
  // (placed at the last pointer position on the notebook)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const newPhoto = buildPhotoAtPointer(src, img);
        setPhotos((prev) => [...prev, newPhoto]);
        setSelectedPhotoId(newPhoto.id);
        showToast("Worksheet uploaded at your pointer! Hold & drag it, use corner to resize.");
        setTutorStatus("Worksheet ready. Write anywhere — uploaded images stay fixed while you write.");
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    // Allow re-uploading the same file
    e.target.value = "";
  };

  return (
    <div className={`flex flex-col h-screen w-full font-sans select-none overflow-hidden transition-colors duration-300 ${
      isDark ? "bg-slate-900 text-slate-100" : "bg-slate-100 text-slate-800"
    }`}>
      {/* Top Ambient Status Header */}
      <header className={`min-h-16 md:min-h-20 lg:min-h-20 h-auto border-b px-3 md:px-5 py-3 md:py-3 flex flex-wrap items-center gap-x-3 gap-y-3 z-20 shadow-xs ${
        isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 font-bold text-lg tracking-tight ${
            isDark ? "text-slate-100" : "text-slate-900"
          }`}>
            <span className="text-blue-600 text-xl md:text-2xl font-serif">Σ</span>cribe
          </div>

          {/* Listening / Tutor Status Badge */}
          <div className={`hidden sm:flex items-center gap-2 ml-2 px-2.5 py-1 border rounded-full text-[10px] md:text-xs font-medium ${
            isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200"
          }`}>
            {isAnalyzing ? (
              <Loader2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-blue-600 animate-spin" />
            ) : (
              <div
                className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full ${
                  isListening ? "bg-amber-500 animate-pulse" : isPlayingAudio ? "bg-purple-500 animate-pulse" : "bg-emerald-500"
                }`}
              />
            )}
            <span className={`truncate max-w-[180px] md:max-w-[240px] ${
              isDark ? "text-slate-300" : "text-slate-600"
            }`}>
              {isListening && speechTranscript ? `Heard: "${speechTranscript}"` : tutorStatus}
            </span>
          </div>
        </div>

        {/* Middle: ASK TUTOR / VOICE QUERY INPUT BOX */}
        <div className="order-2 w-full max-w-none mx-0 sm:order-none sm:w-auto sm:flex-1 sm:min-w-[260px] sm:max-w-xl md:mx-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typedQuestion.trim()) {
                handleVoiceCommand(typedQuestion.trim());
                setTypedQuestion("");
              }
            }}
            className="relative flex items-center"
          >
            <input
              type="text"
              value={typedQuestion}
              onChange={(e) => setTypedQuestion(e.target.value)}
              placeholder="Ask anything..."
              className={`w-full pl-9 pr-16 py-2 bg-gradient-to-r rounded-xl text-xs focus:outline-none focus:ring-2 focus:border-transparent transition placeholder:text-slate-400 ${
                isDark
                  ? "from-slate-800 to-slate-800 border border-slate-700 text-slate-100 focus:ring-blue-400"
                  : "from-blue-50 to-indigo-50 border border-blue-200 text-slate-800 focus:ring-blue-500"
              }`}
            />
            <MessageSquare className="w-3.5 h-3.5 text-blue-500 absolute left-2.5" />
            <button
              type="submit"
              disabled={isAnalyzing || !typedQuestion.trim()}
              className="absolute right-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-40 shadow-sm"
            >
              Ask
            </button>
          </form>
        </div>

        {/* Action Controls — responsive: wrap on small screens, shrink gaps */}
        <div className="order-3 flex flex-[1_1_100%] sm:order-none sm:flex-[1_1_auto] min-w-0 flex-wrap items-center justify-end gap-1.5">
          <button
            onClick={() => setNotebooksOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] md:text-xs font-semibold border transition ${
              isDark ? "bg-slate-800 border-slate-700 text-cyan-200 hover:bg-slate-700" : "bg-cyan-50 border-cyan-200 text-cyan-800 hover:bg-cyan-100"
            }`}
            title={`Open saved notebooks (${activeNotebookTitle})`}
          >
            <BookOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">{activeNotebookTitle}</span>
          </button>
          {/* 1. CHECK ANSWER BUTTON (verify student's solved equation) */}
          <button
            onClick={() => runTutorAnalysis("Audit every visible line and each transition from top to bottom, including arithmetic on coefficients. Find the FIRST incorrect line, explain the exact correction, and return a tight bounding box for that line so it can be underlined on the board. If any earlier step is wrong, do not call later work correct. This may be intermediate work, not a finished solution. Do not write anything on the board.", "check")}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[10px] md:text-xs font-semibold shadow-sm transition disabled:opacity-50"
            title="Check whether your current work is correct so far, even if unfinished"
          >
            <Check className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Check</span>
          </button>

          {/* 2. TUTOR GUIDE BUTTON (hints only — writes nothing) */}
          <button
            onClick={() => runTutorAnalysis("Guide me with ONE Socratic hint for the next single step. Do NOT write anything on the board and do NOT reveal the solution", "guide")}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full text-[10px] md:text-xs font-semibold shadow-sm transition disabled:opacity-50"
            title="Ask the tutor to guide your thinking with a Socratic hint (no writing on canvas)"
          >
            <HelpCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Guide</span>
          </button>

          {/* 3. NEXT STEP BUTTON (next single step only) */}
          <button
            onClick={() => runTutorAnalysis("Continue from my last line with ONLY the next single step. Do NOT give the whole final answer", "autocomplete")}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-full text-[10px] md:text-xs font-semibold transition"
            title="Writes exactly ONE next step after your equation in handwriting"
          >
            <Zap className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Next Step</span>
          </button>

          {/* 3. VOICE MICROPHONE TOGGLE (Hold or Toggle to speak) */}
          <button
            onClick={toggleListening}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] md:text-xs font-semibold border transition ${
              isListening
                ? "bg-amber-500 text-white border-amber-600 shadow-sm animate-pulse ring-2 ring-amber-300"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
            title={isListening ? "Microphone active. Click to pause." : "Click to start microphone"}
          >
            {isListening ? <Mic className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" /> : <MicOff className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />}
            <span className="hidden sm:inline">{isListening ? "Live" : "Mic"}</span>
          </button>

          {/* 4. CHANGE SPEECH OUTPUT (GNANI.AI VOICE SETTINGS) */}
          <button
            onClick={() => setVoiceSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 rounded-full text-[10px] md:text-xs font-semibold transition"
            title="Change Gnani.ai Voice and Speech Output"
          >
            <Settings className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Voice</span>
          </button>

          {/* Audio Mute Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition"
            title={soundEnabled ? "Mute Gnani voice" : "Unmute voice"}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-purple-600" /> : <VolumeX className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />}
          </button>

          {/* Notebook Theme Toggle (Light / Dark) */}
          <button
            onClick={() => setNotebookTheme(isDark ? "light" : "dark")}
            className={`p-1.5 rounded-full border transition ${
              isDark
                ? "border-slate-600 bg-slate-800 hover:bg-slate-700 text-amber-300"
                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            }`}
            title={isDark ? "Switch to light notebook" : "Switch to dark notebook"}
          >
            {isDark ? <Sun className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Moon className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          </button>
        </div>
      </header>

      {notebooksOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm flex items-start justify-center p-4 pt-20" onClick={() => setNotebooksOpen(false)}>
          <section
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"}`}
            onClick={(event) => event.stopPropagation()}
            aria-label="Saved notebooks"
          >
            <header className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-slate-200"}`}>
              <div className="flex items-center gap-2 font-semibold"><BookOpen className="w-4 h-4 text-cyan-600" /> Your notebooks</div>
              <button onClick={() => setNotebooksOpen(false)} className="p-1 rounded-lg hover:bg-slate-100/10" aria-label="Close notebooks"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-3 space-y-2 max-h-[55vh] overflow-auto">
              {savedNotebooks
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((notebook) => (
                  <div
                    key={notebook.id}
                    className={`flex items-center gap-2 px-2 py-2 rounded-xl border transition ${
                      notebook.id === activeNotebookId
                        ? isDark ? "border-cyan-500 bg-cyan-950/40" : "border-cyan-400 bg-cyan-50"
                        : isDark ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <button
                      onClick={() => void switchNotebook(notebook)}
                      className="min-w-0 flex-1 flex items-center justify-between gap-2 px-1 py-1 text-left"
                    >
                      <span className="font-medium truncate">{notebook.title}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">{notebook.id === activeNotebookId ? "Open" : new Date(notebook.updatedAt).toLocaleDateString()}</span>
                    </button>
                    <button
                      onClick={() => void removeNotebook(notebook)}
                      className={`shrink-0 p-2 rounded-lg transition ${isDark ? "text-rose-300 hover:bg-rose-950/60" : "text-rose-600 hover:bg-rose-50"}`}
                      aria-label={`Delete ${notebook.title}`}
                      title={`Delete ${notebook.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
            </div>
            <footer className={`p-3 border-t ${isDark ? "border-slate-700" : "border-slate-200"}`}>
              <button onClick={() => void createNewNotebook()} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold transition">
                <span className="text-lg leading-none">+</span> New notebook
              </button>
              <p className="mt-2 text-center text-[10px] text-slate-500">Saved in this browser. Your boards stay separate.</p>
            </footer>
          </section>
        </div>
      )}

      {/* Scrollable & Extendable Canvas Workspace Area */}
      <div
        className={`flex-1 overflow-auto relative transition-colors duration-300 ${
          isDark ? "bg-slate-800/60 custom-scrollbar-dark" : "bg-slate-200/60 custom-scrollbar"
        }`}
        ref={containerRef}
      >
        {/* The Extendable Whiteboard Canvas Sheet */}
        <div
          className={`relative shadow-xl mx-auto transition-colors duration-300 ${
            isDark ? "bg-slate-900 bg-grid-pattern-dark" : "bg-white bg-grid-pattern"
          }`}
          style={{
            width: `${canvasDimensions.width}px`,
            height: `${canvasDimensions.height}px`,
            minWidth: "100%",
          }}
        >
          {/* 1. ADJUSTABLE WORKSHEET PHOTOS (MULTIPLE)
              - Selected photo: dashed frame + drag bar + resize corner
              - Unselected photos are FIXED: non-interactive, draw right through them
                (a small "Adjust" chip appears above each to unlock it) */}
          {photos.map((p) => {
            const isSelected = selectedPhotoId === p.id;
            return (
              <div
                key={p.id}
                className={`absolute select-none ${isSelected ? "z-10" : "z-0 pointer-events-none"}`}
                style={{
                  left: `${p.x}px`,
                  top: `${p.y}px`,
                  width: `${p.width}px`,
                  height: `${p.height}px`,
                }}
              >
                {/* Small "Adjust" chip shown only when this photo is fixed */}
                {!isSelected && (
                  <button
                    onClick={() => setSelectedPhotoId(p.id)}
                    className="pointer-events-auto absolute -top-7 left-0 z-30 flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[9px] md:text-[10px] font-bold rounded-md shadow-md transition"
                    title="Click to unlock this image so you can move or resize it"
                  >
                    <Move className="w-3 h-3" />
                    Adjust
                  </button>
                )}

                {/* Photo Header Bar: Drag to Move Handle & Size Controls (selected only) */}
                {isSelected && (
                  <div
                    onPointerDown={(e) => handlePhotoDragStart(e, p.id)}
                    className="absolute -top-10 left-0 right-0 h-9 bg-slate-900/95 backdrop-blur-md text-white text-[10px] md:text-xs px-2.5 rounded-t-lg flex items-center justify-between cursor-move shadow-lg border border-blue-400/40 z-20"
                    title="Drag this bar to move the worksheet"
                  >
                    <div className="flex items-center gap-1 font-medium truncate pointer-events-none">
                      <Move className="w-3 h-3 md:w-3.5 md:h-3.5 text-blue-400 flex-shrink-0" />
                      <span className="text-[10px] md:text-[11px] font-semibold text-slate-100">Move worksheet</span>
                    </div>

                    <div className="flex items-center gap-0.5 md:gap-1" onPointerDown={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handlePhotoZoom(p.id, 0.85)}
                        className="p-0.5 md:p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition"
                        title="Zoom Out Photo (-15%)"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </button>
                      <span className="text-[9px] md:text-[10px] text-slate-400 font-mono px-0.5">
                        {Math.round(p.width)}px
                      </span>
                      <button
                        onClick={() => handlePhotoZoom(p.id, 1.15)}
                        className="p-0.5 md:p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition"
                        title="Zoom In Photo (+15%)"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => resetPhotoWidth(p.id)}
                        className="p-0.5 md:p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition"
                        title="Reset to default width"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removePhoto(p.id)}
                        className="p-0.5 md:p-1 hover:bg-red-600 rounded text-slate-400 hover:text-white transition ml-1"
                        title="Remove Photo"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* The Photo Image — press & hold the image itself to drag when selected */}
                <div
                  className={`w-full h-full overflow-hidden relative ${
                    isSelected
                      ? "border-2 border-dashed border-blue-400/80 rounded-b-lg rounded-tr-lg shadow-lg"
                      : "border border-transparent"
                  }`}
                  style={{ backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "transparent" }}
                >
                  <img
                    src={p.src}
                    alt="Worksheet"
                    draggable={false}
                    onPointerDown={(e) => {
                      if (isSelected) {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePhotoDragStart(e, p.id); // Hold + drag the image itself to move it
                      }
                    }}
                    className={`w-full h-full object-contain ${
                      isSelected ? "pointer-events-auto cursor-move" : "pointer-events-none"
                    }`}
                  />
                </div>

                {/* Bottom-Right Corner Resize Handle (selected only) */}
                {isSelected && (
                  <div
                    onPointerDown={(e) => handlePhotoResizeStart(e, p.id)}
                    className="absolute -bottom-2.5 -right-2.5 w-6 h-6 bg-blue-600 hover:bg-blue-700 active:scale-110 text-white rounded-full flex items-center justify-center cursor-nwse-resize shadow-md border-2 border-white z-20 transition"
                    title="Drag to resize worksheet photo"
                  >
                    <Maximize2 className="w-3 h-3 rotate-90" />
                  </div>
                )}
              </div>
            );
          })}

          {/* 2. Whiteboard Drawing Canvas
              NOTE: width/height attributes are intentionally NOT React props.
              resizeCanvas manages the pixel buffer; if React re-set those
              attributes on re-render, setting canvas.width wipes the bitmap! */}
          <canvas
            ref={canvasRef}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            className={`absolute inset-0 touch-none ${
              tool === "selectErase" ? "cursor-crosshair" : "cursor-crosshair"
            }`}
            style={{
              width: `${canvasDimensions.width}px`,
              height: `${canvasDimensions.height}px`,
            }}
          />

          {/* 3. AI Annotation Overlay Layer */}
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{
              width: `${canvasDimensions.width}px`,
              height: `${canvasDimensions.height}px`,
            }}
          />

          {/* 4. Canvas Bottom Auto-Extend Hint (page extends automatically on scroll) */}
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-6 bg-slate-900/90 backdrop-blur text-white text-xs px-3.5 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Floating Live Speech Transcript Pill */}
      {isListening && speechTranscript && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg z-40 flex items-center gap-2 animate-pulse">
          <Mic className="w-3.5 h-3.5 text-white" />
          <span>Listening: "{speechTranscript}"</span>
        </div>
      )}

      {/* Floating Tutor Guidance Card (when "Guide Me" is clicked) */}
      {tutorGuideHint && (
        <div className="fixed top-28 left-6 max-w-[calc(100vw-1.5rem)] bg-amber-50 border-l-4 border-amber-500 shadow-lg rounded-r-lg p-3.5 flex items-start gap-3 z-30 transition-all">
          <HelpCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <span className="font-bold text-amber-900 block mb-0.5">Tutor Guidance:</span>
            <p className="text-amber-900 leading-relaxed">{tutorGuideHint}</p>
          </div>
          <button
            onClick={() => setTutorGuideHint(null)}
            className="text-amber-400 hover:text-amber-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating Error Hint Banner (if mistake detected) */}
      {activeHint && (
        <div className="fixed top-40 left-6 max-w-[calc(100vw-1.5rem)] bg-red-50 border-l-4 border-red-500 shadow-lg rounded-r-lg p-3.5 flex items-start gap-3 z-30 transition-all">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <span className="font-bold text-red-900 block mb-0.5">Mistake Detected:</span>
            <p className="text-red-800 leading-relaxed">{activeHint}</p>
          </div>
          <button
            onClick={() => setActiveHint(null)}
            className="text-red-400 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating Tutor Voice Pill — minimal indicator with one-tap replay */}
      {lastSpeechExplanation && (
        <div
          className={`fixed bottom-36 left-6 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-md backdrop-blur text-[11px] md:text-xs font-semibold max-w-[calc(100vw-1.5rem)] transition-colors ${
            isDark ? "bg-slate-900/95 border-slate-700 text-slate-200" : "bg-white/95 border-slate-200 text-slate-700"
          }`}
          title={lastSpeechExplanation}
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPlayingAudio ? "bg-purple-500 animate-pulse" : "bg-slate-400"}`} />
          <span className="truncate">
            <span className="text-purple-600">Tutor ({selectedVoice}):</span>{" "}
            {isPlayingAudio ? "Speaking..." : lastSpeechExplanation}
          </span>
          <button
            onClick={() => playGnaniSpeech(lastSpeechExplanation)}
            className="p-0.5 text-slate-400 hover:text-purple-600 flex-shrink-0"
            title="Replay voice audio"
          >
            <Play className="w-3 h-3 md:w-4 md:h-4" />
          </button>
        </div>
      )}

      {/* Floating Interactive 2D Graph Widget */}
      {graphData && (
        <div className={`fixed bottom-24 right-6 ${
          typeof window !== "undefined" && window.innerWidth < 640
            ? "left-6 right-6 bottom-16 w-auto"
            : "w-80"
        } bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden z-30`}>
          <div className="px-3.5 py-2.5 bg-slate-800 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LineChart className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-semibold truncate">{graphData.title || `Plot: ${graphData.function}`}</span>
            </div>
            <button
              onClick={() => setGraphData(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 bg-white">
            <InteractiveGraphPlot expression={graphData.function} />
            <div className="mt-2 text-[10px] text-slate-500 text-center font-mono">
              Function: y = {graphData.function}
            </div>
          </div>
        </div>
      )}

      {/* Floating Whiteboard Toolbox (Fixed at bottom center — wraps on small screens) */}
      <div className={`fixed bottom-6 ${
        typeof window !== "undefined" && window.innerWidth < 640
          ? "left-0 right-0 -translate-x-1/2 translate-x-0 w-[calc(100%-1.5rem)]"
          : "left-1/2 -translate-x-1/2"
      } backdrop-blur-md border shadow-2xl rounded-2xl px-3 py-2 md:px-4 md:py-2.5 flex flex-wrap items-center justify-center gap-2 md:gap-3.5 z-30 transition-colors duration-300 ${
        isDark ? "bg-slate-900/95 border-slate-700" : "bg-white/95 border-slate-200"
      }`}>
        {/* Tool Selection: Pen, Eraser, Select-to-Erase */}
        <div className={`flex items-center gap-1 border-r pr-3 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
          <button
            onClick={() => setTool("pen")}
            className={`p-2 rounded-xl transition ${
              tool === "pen" ? "bg-blue-600 text-white shadow-md shadow-blue-900/20" : isDark ? "text-slate-300 hover:bg-slate-800 hover:text-blue-300" : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
            }`}
            title="Pen (Write & Draw)"
          >
            <Pen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`p-2 rounded-xl transition ${
              tool === "eraser" ? "bg-amber-500 text-white shadow-md shadow-amber-900/20" : isDark ? "text-slate-300 hover:bg-slate-800 hover:text-amber-300" : "text-slate-600 hover:bg-amber-50 hover:text-amber-600"
            }`}
            title="Stroke Eraser"
          >
            <Eraser className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTool("selectErase")}
            className={`p-2 rounded-xl transition ${
              tool === "selectErase" ? "bg-rose-500 text-white shadow-md shadow-rose-900/20" : isDark ? "text-slate-300 hover:bg-slate-800 hover:text-rose-300" : "text-slate-600 hover:bg-rose-50 hover:text-rose-600"
            }`}
            title="Select Area to Erase (Drag a box over text/drawings to remove them)"
          >
            <Crop className="w-4 h-4" />
          </button>
        </div>

        {/* Undo / Redo History */}
        <div className={`flex items-center gap-1 border-r pr-3 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
          <button
            onClick={undoLastStroke}
            disabled={!canUndo}
            className={`p-2 rounded-xl transition ${
              canUndo ? isDark ? "text-cyan-300 hover:bg-slate-800 active:scale-90" : "text-cyan-700 hover:bg-cyan-50 active:scale-90" : isDark ? "text-slate-600 cursor-not-allowed" : "text-slate-300 cursor-not-allowed"
            }`}
            title="Undo last stroke / clear (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redoLastStroke}
            disabled={!canRedo}
            className={`p-2 rounded-xl transition ${
              canRedo ? isDark ? "text-violet-300 hover:bg-slate-800 active:scale-90" : "text-violet-700 hover:bg-violet-50 active:scale-90" : isDark ? "text-slate-600 cursor-not-allowed" : "text-slate-300 cursor-not-allowed"
            }`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Ink Color Palette */}
        {tool === "pen" && (
          <div className={`flex items-center gap-1.5 border-r pr-3 ${isDark ? "border-slate-700" : "border-slate-200"}`}>
            {[
              { hex: "#1e293b", label: "Black" },
              { hex: "#2563eb", label: "Blue" },
              { hex: "#059669", label: "Green" },
              { hex: "#dc2626", label: "Red" },
              { hex: "#7c3aed", label: "Purple" },
            ].map((c) => (
              <button
                key={c.hex}
                onClick={() => setColor(c.hex)}
                className={`w-5 h-5 rounded-full border transition ${
                  color === c.hex ? "ring-2 ring-blue-500 scale-110" : "opacity-80 hover:opacity-100"
                }`}
                style={{ backgroundColor: isDark && c.hex === "#1e293b" ? "#ffffff" : c.hex }}
                title={c.label}
              />
            ))}
          </div>
        )}

        {/* Stroke Thickness */}
        <div className="flex items-center gap-2 border-r border-slate-200 pr-3">
          <input
            type="range"
            min="1"
            max="10"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className={`w-16 h-1.5 rounded-lg appearance-none cursor-pointer ${isDark ? "bg-slate-700 accent-cyan-400" : "bg-slate-200 accent-blue-600"}`}
            title={`Stroke width: ${strokeWidth}px`}
          />
        </div>

        {/* Upload Problem Sheet / Worksheet */}
        <label className={`p-2 rounded-xl cursor-pointer transition ${isDark ? "text-emerald-300 hover:bg-slate-800 hover:text-emerald-200" : "text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"}`} title="Upload Problem Sheet Image or PDF snapshot">
          <Upload className="w-4 h-4" />
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>

        {/* Paste Screenshot Help hint */}
        <button
          onClick={() => showToast("Press Ctrl+V anywhere to paste a screenshot directly onto the canvas!")}
          className={`p-2 rounded-xl transition ${isDark ? "text-sky-300 hover:bg-slate-800 hover:text-sky-200" : "text-sky-700 hover:bg-sky-50 hover:text-sky-800"}`}
          title="Paste Screenshot (Press Ctrl+V)"
        >
          <ClipboardPaste className="w-4 h-4" />
        </button>

        {/* Clear Canvas */}
        <button
          onClick={clearAllTextFromNotebook}
          className={`p-2 rounded-xl transition ${isDark ? "text-rose-300 hover:bg-rose-950/60 hover:text-rose-200" : "text-rose-600 hover:bg-rose-50 hover:text-rose-700"}`}
          title="Clear All Text and Photos from Notebook"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Voice Settings Modal (Change Speech Output) */}
      {voiceSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-purple-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                <h3 className="font-bold text-base">Gnani.ai Speech Settings</h3>
              </div>
              <button onClick={() => setVoiceSettingsOpen(false)} className="text-purple-200 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Voice Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Select Gnani.ai Voice
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {GNANI_VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVoice(v.id)}
                      className={`px-3 py-2 text-xs rounded-xl border text-left flex items-center justify-between transition ${
                        selectedVoice === v.id
                          ? "bg-purple-50 border-purple-500 text-purple-900 font-bold ring-1 ring-purple-500"
                          : "border-slate-200 hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      <span>{v.id}</span>
                      <span className="text-[10px] text-slate-400 font-normal">({v.gender})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Speech Output Language
                </label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {GNANI_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label} ({lang.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Speech Speed */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Speaking Rate (Speed)
                  </label>
                  <span className="text-xs font-mono font-semibold text-purple-700">{speechSpeed}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={speechSpeed}
                  onChange={(e) => setSpeechSpeed(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
              </div>

              {/* Preview Button */}
              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  onClick={testCurrentVoice}
                  disabled={isTestingVoice || isPlayingAudio}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-xl text-xs font-bold transition disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {isTestingVoice ? "Testing Voice..." : "Test Voice Output"}
                </button>
                <button
                  onClick={() => {
                    setVoiceSettingsOpen(false);
                    showToast(`Voice set to ${selectedVoice} (${selectedLanguage})`);
                  }}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Lightweight INTERACTIVE 3D Function Plotter
// - If the expression contains "y": renders a true 3D surface z = f(x, y)
// - Otherwise: renders the curve z = f(x) as a 3D "curtain" over the floor
// INTERACTION: drag to rotate (yaw/pitch), mouse wheel / pinch to zoom,
// and it slowly auto-rotates until the user grabs it.
function InteractiveGraphPlot({ expression }: { expression: string }) {
  const plotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ yaw: 0.6, pitch: 0.5, zoom: 0.9, autoRotating: true, dragging: false, lastX: 0, lastY: 0 });

  // Safe expression -> JS function
  const buildFns = () => {
    let clean = expression
      .replace(/\^/g, "**")
      .replace(/sin/g, "Math.sin")
      .replace(/cos/g, "Math.cos")
      .replace(/tan/g, "Math.tan")
      .replace(/sqrt/g, "Math.sqrt")
      .replace(/exp/g, "Math.exp")
      .replace(/log/g, "Math.log");
    clean = clean.replace(/(\d)x/g, "$1*x").replace(/(\d)y/g, "$1*y");
    const isSurface = /\by\b/.test(clean);
    try {
      const fn = new Function(
        "x",
        "y",
        `with (Math) { return ${isSurface ? clean : clean}; }`
      ) as (x: number, y: number) => number;
      return { fn: (x: number, y: number) => (isSurface ? fn(x, y) : fn(x, 0)), isSurface };
    } catch {
      return { fn: () => 0, isSurface: false };
    }
  };

  useEffect(() => {
    const canvas = plotCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const { fn, isSurface } = buildFns();
    const RANGE = 5;

    const draw = () => {
      const view = viewRef.current;
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const scale = 26 * view.zoom;
      const cx = width / 2;
      const originY = height / 2 + height * 0.12;

      const project = (x: number, y: number, z: number): { sx: number; sy: number; depth: number } => {
        // yaw rotates the world around the vertical (z) axis
        const xr = x * cy - y * sy;
        const yr = x * sy + y * cy;
        // pitch tilts the world toward the camera
        const sz = yr * cp - z * sp;
        const depth = yr * sp + z * cp;
        return { sx: cx + xr * scale, sy: originY - sz * scale, depth };
      };

      ctx.clearRect(0, 0, width, height);

      // ---- Coordinate grid on the floor (z = 0) ----
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#cbd5e1";
      for (let g = -RANGE; g <= RANGE; g++) {
        const a1 = project(-RANGE, g, 0);
        const a2 = project(RANGE, g, 0);
        const b1 = project(g, -RANGE, 0);
        const b2 = project(g, RANGE, 0);
        ctx.beginPath();
        ctx.moveTo(a1.sx, a1.sy); ctx.lineTo(a2.sx, a2.sy);
        ctx.moveTo(b1.sx, b1.sy); ctx.lineTo(b2.sx, b2.sy);
        ctx.stroke();
      }

      // ---- Axes (x: red, y: green, z: blue) ----
      const drawAxis = (p: { sx: number; sy: number }, q: { sx: number; sy: number }, color: string, label: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(label, q.sx + 3, q.sy + 3);
      };
      drawAxis(project(0, 0, 0), project(RANGE + 1.5, 0, 0), "#dc2626", "x");
      drawAxis(project(0, 0, 0), project(0, RANGE + 1.5, 0), "#059669", "y");
      drawAxis(project(0, 0, 0), project(0, 0, (isSurface ? RANGE : 4) + 1), "#2563eb", "z");

      // ---- Geometry ----
      const clampZ = (v: number) => (isFinite(v) ? clampNumber(v, -40, 60) : 0);

      if (isSurface) {
        // Surface mesh z = f(x, y) — depth-sorted translucent quads
        const N = 22;
        const quads: { pts: { sx: number; sy: number }[]; depth: number; h: number }[] = [];
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const x0 = -RANGE + (2 * RANGE * i) / N;
            const x1 = -RANGE + (2 * RANGE * (i + 1)) / N;
            const y0 = -RANGE + (2 * RANGE * j) / N;
            const y1 = -RANGE + (2 * RANGE * (j + 1)) / N;
            const p1 = project(x0, y0, clampZ(fn(x0, y0)));
            const p2 = project(x1, y0, clampZ(fn(x1, y0)));
            const p3 = project(x1, y1, clampZ(fn(x1, y1)));
            const p4 = project(x0, y1, clampZ(fn(x0, y1)));
            quads.push({
              pts: [p1, p2, p3, p4],
              depth: (p1.depth + p2.depth + p3.depth + p4.depth) / 4,
              h: Math.min(1, Math.max(0, (clampZ(fn((x0 + x1) / 2, (y0 + y1) / 2)) + RANGE) / (2 * RANGE))),
            });
          }
        }
        quads.sort((a, b) => a.depth - b.depth);
        quads.forEach((q) => {
          ctx.beginPath();
          ctx.moveTo(q.pts[0].sx, q.pts[0].sy);
          q.pts.slice(1).forEach((pt) => ctx.lineTo(pt.sx, pt.sy));
          ctx.closePath();
          // Height-based violet shading stands apart from the RGB axes.
          const alpha = 0.25 + 0.45 * q.h;
          ctx.fillStyle = `rgba(124, 58, 237, ${alpha.toFixed(2)})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(76, 29, 149, 0.55)";
          ctx.lineWidth = 0.6;
          ctx.stroke();
        });
      } else {
        // Curve mode: z = f(x) as a floating 3D curtain over the floor
        const samples: { sx: number; sy: number }[] = [];
        const shadows: { sx: number; sy: number }[] = [];
        for (let i = 0; i <= 120; i++) {
          const x = -RANGE + (2 * RANGE * i) / 120;
          samples.push(project(x, 0, clampZ(fn(x, 0))));
          shadows.push(project(x, 0, 0));
        }

        // curtain drop lines
        ctx.strokeStyle = "rgba(124, 58, 237, 0.28)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 120; i += 3) {
          ctx.beginPath();
          ctx.moveTo(samples[i].sx, samples[i].sy);
          ctx.lineTo(shadows[i].sx, shadows[i].sy);
          ctx.stroke();
        }

        // floor shadow curve
        ctx.strokeStyle = "rgba(100, 116, 139, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        shadows.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.sx, pt.sy) : ctx.lineTo(pt.sx, pt.sy)));
        ctx.stroke();

        // main glowing 3D curve
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = 3;
        ctx.beginPath();
        samples.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.sx, pt.sy) : ctx.lineTo(pt.sx, pt.sy)));
        ctx.stroke();
      }

      // second frame while auto-rotating
      if (view.autoRotating) {
        view.yaw += 0.012;
        requestAnimationFrame(draw);
      }
    };

    draw();

    // ---- Interaction handlers ----
    const onPointerDown = (e: PointerEvent) => {
      const view = viewRef.current;
      view.dragging = true;
      view.autoRotating = false;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const view = viewRef.current;
      if (!view.dragging) return;
      view.yaw += (e.clientX - view.lastX) * 0.01;
      view.pitch = clampNumber(view.pitch + (e.clientY - view.lastY) * 0.008, 0.05, 1.5);
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      if (!view.autoRotating) draw();
    };
    const onPointerUp = () => {
      viewRef.current.dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      view.zoom = clampNumber(view.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.4, 2.6);
      if (!view.autoRotating) draw();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      viewRef.current.autoRotating = false;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [expression]);

  return (
    <canvas
      ref={plotCanvasRef}
      width={300}
      height={210}
      className="w-full h-auto bg-white rounded-lg border border-slate-200 cursor-grab active:cursor-grabbing touch-none"
      title="Interactive 3D graph — drag to rotate, scroll to zoom"
    />
  );
}
