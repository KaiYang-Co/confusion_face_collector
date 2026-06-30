const $ = (selector) => document.querySelector(selector);

const experimentSetup = $("#experimentSetup");
const subjectIdInput = $("#subjectId");
const readingIdInput = $("#readingId");
const notesInput = $("#notes");
const readingTitleInput = $("#readingTitle");
const readingTextInput = $("#readingText");
const textFileInput = $("#textFileInput");
const savedMaterialSelect = $("#savedMaterialSelect");
const loadMaterialButton = $("#loadMaterialButton");
const deleteMaterialButton = $("#deleteMaterialButton");
const exportMaterialButton = $("#exportMaterialButton");
const materialFileInput = $("#materialFileInput");
const questionEditorList = $("#questionEditorList");
const addQuestionButton = $("#addQuestionButton");
const confirmContentButton = $("#confirmContentButton");
const confirmedSummary = $("#confirmedSummary");
const confirmedTitle = $("#confirmedTitle");
const confirmedDetails = $("#confirmedDetails");
const editContentButton = $("#editContentButton");
const readerPanel = $("#readerPanel");
const displayReadingTitle = $("#displayReadingTitle");
const displayReadingText = $("#displayReadingText");
const displayQuestionList = $("#displayQuestionList");
const readerScrollArea = $("#readerScrollArea");
const fontDecreaseButton = $("#fontDecreaseButton");
const fontIncreaseButton = $("#fontIncreaseButton");
const preview = $("#preview");
const cameraPlaceholder = $("#cameraPlaceholder");
const recordingBadge = $("#recordingBadge");
const statusText = $("#statusText");
const timer = $("#timer");
const markerCount = $("#markerCount");
const sessionLabel = $("#sessionLabel");
const markerList = $("#markerList");
const markerFlash = $("#markerFlash");
const message = $("#message");
const startButton = $("#startButton");
const markButton = $("#markButton");
const undoButton = $("#undoButton");
const stopButton = $("#stopButton");

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let confusionIntervals = [];
let activeConfusion = null;
let activeInputSource = null;
let sessionId = null;
let recording = false;
let contentConfirmed = false;
let confirmedContent = null;
let sessionStartPerf = 0;
let captureStartedAtIso = null;
let timerHandle = null;
let flashHandle = null;
let readingFontSize = 24;
let questionSerial = 0;
let savedMaterials = [];
const LEGACY_MATERIAL_STORAGE_KEY = "confusion_face_collector_materials_v1";

function formatTime(milliseconds) {
  const safe = Math.max(0, Number(milliseconds) || 0);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = Math.floor(safe % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(millis).padStart(3, "0")}`;
}

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message${type ? ` ${type}` : ""}`;
}

function updateControls() {
  startButton.disabled = !contentConfirmed || recording;
  markButton.disabled = !recording;
  undoButton.disabled =
    !recording || activeConfusion !== null || confusionIntervals.length === 0;
  stopButton.disabled = !recording;
  editContentButton.disabled = recording;
}

function createQuestionEditor(initial = {}) {
  questionSerial += 1;
  const editor = document.createElement("section");
  editor.className = "question-editor";
  editor.dataset.questionKey = String(questionSerial);

  const header = document.createElement("div");
  header.className = "question-editor-header";
  const label = document.createElement("strong");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-question";
  removeButton.textContent = "Delete";
  header.append(label, removeButton);

  const questionInput = document.createElement("input");
  questionInput.className = "question-input";
  questionInput.placeholder = "Enter the question";
  questionInput.value = initial.text || "";

  const optionGrid = document.createElement("div");
  optionGrid.className = "option-editor-grid";
  const letters = ["A", "B", "C", "D"];
  letters.forEach((letter, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "option-editor";
    const prefix = document.createElement("span");
    prefix.textContent = letter;
    const input = document.createElement("input");
    input.className = "option-input";
    input.placeholder = `Option ${letter}`;
    input.value = initial.options?.[index] || "";
    wrapper.append(prefix, input);
    optionGrid.append(wrapper);
  });

  removeButton.addEventListener("click", () => {
    editor.remove();
    renumberQuestionEditors();
  });

  editor.append(header, questionInput, optionGrid);
  questionEditorList.append(editor);
  renumberQuestionEditors();
}

function renumberQuestionEditors() {
  [...questionEditorList.querySelectorAll(".question-editor")].forEach(
    (editor, index) => {
      editor.querySelector("strong").textContent = `Question ${index + 1}`;
    }
  );
}

function readQuestionsFromEditor() {
  return [...questionEditorList.querySelectorAll(".question-editor")]
    .map((editor, index) => ({
      question_id: `q${index + 1}`,
      text: editor.querySelector(".question-input").value.trim(),
      options: [...editor.querySelectorAll(".option-input")].map((input) =>
        input.value.trim()
      ),
    }))
    .filter(
      (question) =>
        question.text || question.options.some((option) => option.length > 0)
    );
}

function validateContent() {
  if (!subjectIdInput.value.trim() || !readingIdInput.value.trim()) {
    return "Enter the participant ID and reading ID.";
  }
  if (!readingTextInput.value.trim()) {
    return "Paste or import the reading text.";
  }

  const questions = readQuestionsFromEditor();
  for (const [index, question] of questions.entries()) {
    if (!question.text) return `Question ${index + 1} has no question text.`;
    const filledOptions = question.options.filter(Boolean);
    if (filledOptions.length < 2) {
      return `Question ${index + 1} needs at least two options.`;
    }
  }
  return "";
}

function getLegacySavedMaterials() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(LEGACY_MATERIAL_STORAGE_KEY) || "[]"
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function materialLabel(material) {
  return material.reading_title || material.reading_id || "Untitled Reading";
}

function renderSavedMaterialSelect(selectedId = "") {
  const materials = [...savedMaterials].sort((a, b) =>
    materialLabel(a).localeCompare(materialLabel(b))
  );
  savedMaterialSelect.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select a locally saved material...";
  savedMaterialSelect.append(empty);

  for (const material of materials) {
    const option = document.createElement("option");
    option.value = material.template_id;
    option.textContent = `${materialLabel(material)} (${material.questions?.length || 0} questions)`;
    savedMaterialSelect.append(option);
  }
  savedMaterialSelect.value = selectedId;
  updateTemplateButtons();
}

async function refreshSavedMaterialSelect(selectedId = "") {
  const response = await fetch("/api/materials");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load saved materials");
  }
  savedMaterials = Array.isArray(payload.materials) ? payload.materials : [];
  renderSavedMaterialSelect(selectedId);
}

async function migrateBrowserMaterials() {
  const legacyMaterials = getLegacySavedMaterials();
  if (legacyMaterials.length === 0) return false;

  for (const material of legacyMaterials) {
    if (
      material &&
      typeof material.reading_text === "string" &&
      Array.isArray(material.questions)
    ) {
      await postJson("/api/materials", material);
    }
  }
  window.localStorage.removeItem(LEGACY_MATERIAL_STORAGE_KEY);
  return true;
}

async function initializeSavedMaterials() {
  try {
    const migrated = await migrateBrowserMaterials();
    await refreshSavedMaterialSelect();
    if (migrated) {
      setMessage(
        "Existing browser-saved materials were moved to the local materials folder.",
        "success"
      );
    }
  } catch (error) {
    savedMaterials = [];
    renderSavedMaterialSelect();
    setMessage(`Could not load local materials: ${error.message}`, "error");
  }
}

function updateTemplateButtons() {
  const hasSelection = Boolean(savedMaterialSelect.value);
  loadMaterialButton.disabled = !hasSelection;
  deleteMaterialButton.disabled = !hasSelection;
}

function buildMaterialTemplate() {
  return {
    schema: "confusion-face-reading-material",
    version: 1,
    template_id:
      confirmedContent?.template_id ||
      savedMaterialSelect.value ||
      `material_${Date.now()}`,
    reading_id: readingIdInput.value.trim(),
    reading_title: readingTitleInput.value.trim(),
    reading_text: readingTextInput.value,
    questions: readQuestionsFromEditor(),
    updated_at_iso: new Date().toISOString(),
  };
}

async function saveMaterialTemplate(template) {
  const saved = await postJson("/api/materials", template);
  const savedTemplate = saved.material;
  const index = savedMaterials.findIndex(
    (item) => item.template_id === savedTemplate.template_id
  );
  if (index >= 0) savedMaterials[index] = savedTemplate;
  else savedMaterials.push(savedTemplate);
  renderSavedMaterialSelect(savedTemplate.template_id);
  return savedTemplate;
}

async function deleteMaterialTemplate(templateId) {
  const response = await fetch(
    `/api/materials/${encodeURIComponent(templateId)}`,
    { method: "DELETE" }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Failed to delete material");
  }
  savedMaterials = savedMaterials.filter(
    (item) => item.template_id !== templateId
  );
  renderSavedMaterialSelect();
}

function loadMaterialTemplate(template) {
  readingIdInput.value = template.reading_id || "";
  readingTitleInput.value = template.reading_title || "";
  readingTextInput.value = template.reading_text || "";
  questionEditorList.replaceChildren();
  questionSerial = 0;
  const questions = Array.isArray(template.questions)
    ? template.questions
    : [];
  if (questions.length === 0) createQuestionEditor();
  else questions.forEach((question) => createQuestionEditor(question));
  savedMaterialSelect.value = template.template_id || "";
  updateTemplateButtons();
}

function selectedMaterialTemplate() {
  return savedMaterials.find(
    (item) => item.template_id === savedMaterialSelect.value
  );
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderReading() {
  displayReadingTitle.textContent =
    confirmedContent.reading_title || confirmedContent.reading_id;
  displayReadingText.replaceChildren();

  const paragraphs = confirmedContent.reading_text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraphText of paragraphs) {
    const paragraph = document.createElement("p");
    paragraph.textContent = paragraphText.replace(/\s*\n\s*/g, " ");
    displayReadingText.append(paragraph);
  }

  displayReadingText.style.fontSize = `${readingFontSize}px`;
  renderQuestions();
  readerScrollArea.scrollTop = 0;
}

function renderQuestions() {
  displayQuestionList.replaceChildren();
  const questions = confirmedContent.questions;

  if (questions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "No questions were configured for this reading.";
    displayQuestionList.append(empty);
    return;
  }

  questions.forEach((question, questionIndex) => {
    const card = document.createElement("section");
    card.className = "question-card";
    card.dataset.questionId = question.question_id;

    const text = document.createElement("p");
    text.className = "question-text";
    text.textContent = `${questionIndex + 1}. ${question.text}`;

    const options = document.createElement("div");
    options.className = "answer-options";
    question.options.forEach((option, optionIndex) => {
      if (!option) return;
      const label = document.createElement("label");
      label.className = "answer-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `answer_${question.question_id}`;
      input.value = String(optionIndex);
      const span = document.createElement("span");
      span.textContent = `${String.fromCharCode(65 + optionIndex)}. ${option}`;
      label.append(input, span);
      options.append(label);
    });

    card.append(text, options);
    displayQuestionList.append(card);
  });
}

function collectAnswers() {
  return confirmedContent.questions.map((question) => {
    const selected = document.querySelector(
      `input[name="answer_${question.question_id}"]:checked`
    );
    const selectedIndex = selected ? Number(selected.value) : null;
    return {
      question_id: question.question_id,
      selected_option_index: selectedIndex,
      selected_option_text:
        selectedIndex === null ? null : question.options[selectedIndex],
    };
  });
}

async function confirmContent() {
  const error = validateContent();
  if (error) {
    window.alert(error);
    return;
  }

  confirmedContent = {
    subject_id: subjectIdInput.value.trim(),
    reading_id: readingIdInput.value.trim(),
    notes: notesInput.value.trim(),
    reading_title: readingTitleInput.value.trim(),
    reading_text: readingTextInput.value,
    questions: readQuestionsFromEditor(),
  };
  confirmContentButton.disabled = true;
  let savedTemplate;
  try {
    savedTemplate = await saveMaterialTemplate(buildMaterialTemplate());
  } catch (saveError) {
    confirmedContent = null;
    window.alert(`Could not save the reading locally: ${saveError.message}`);
    return;
  } finally {
    confirmContentButton.disabled = false;
  }
  confirmedContent.template_id = savedTemplate.template_id;
  contentConfirmed = true;

  experimentSetup.classList.add("hidden");
  confirmedSummary.classList.remove("hidden");
  readerPanel.classList.remove("hidden");
  confirmedTitle.textContent =
    confirmedContent.reading_title || confirmedContent.reading_id;
  confirmedDetails.textContent = `${confirmedContent.reading_text.length} characters, ${confirmedContent.questions.length} questions. Saved locally as "${materialLabel(savedTemplate)}".`;
  renderReading();
  window.scrollTo({ top: 0, behavior: "instant" });
  setMessage(
    'Content is locked. When the camera is ready, click "Start Collection".'
  );
  updateControls();
}

function editContent() {
  if (recording) return;
  contentConfirmed = false;
  confirmedContent = null;
  experimentSetup.classList.remove("hidden");
  confirmedSummary.classList.add("hidden");
  readerPanel.classList.add("hidden");
  setMessage("");
  updateControls();
}

function elapsedMs(now = performance.now()) {
  return Math.max(0, Math.round(now - sessionStartPerf));
}

function renderIntervals() {
  markerCount.textContent = String(
    confusionIntervals.length + (activeConfusion ? 1 : 0)
  );
  markerList.replaceChildren();
  if (confusionIntervals.length === 0 && !activeConfusion) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Hold Space while confused, then release it.";
    markerList.append(empty);
  } else {
    confusionIntervals.forEach((interval) => {
      const item = document.createElement("li");
      item.textContent = `Interval ${interval.event_id} · ${formatTime(
        interval.start_time_ms
      )} – ${formatTime(interval.end_time_ms)} (${formatTime(
        interval.duration_ms
      )})`;
      markerList.append(item);
    });
    if (activeConfusion) {
      const item = document.createElement("li");
      item.className = "active";
      item.textContent = `Interval ${activeConfusion.event_id} · ${formatTime(
        activeConfusion.start_time_ms
      )} – active`;
      markerList.append(item);
    }
    markerList.scrollTop = markerList.scrollHeight;
  }
  markButton.classList.toggle("active", Boolean(activeConfusion));
  markButton.textContent = activeConfusion
    ? "Confusion Active — Release"
    : "Hold to Mark Confusion";
  if (recording) {
    statusText.textContent = activeConfusion ? "Confused" : "Recording";
  }
  updateControls();
}

function chooseMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return (
    candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function startCapture() {
  if (!contentConfirmed || !confirmedContent) return;
  startButton.disabled = true;
  editContentButton.disabled = true;
  setMessage("Requesting camera permission...");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 15 },
        facingMode: "user",
      },
    });

    preview.srcObject = mediaStream;
    cameraPlaceholder.classList.add("hidden");
    await preview.play();

    const cameraSettings =
      mediaStream.getVideoTracks()[0]?.getSettings?.() || {};
    const created = await postJson("/api/session/start", {
      ...confirmedContent,
      requested_capture: {
        width: 1280,
        height: 720,
        frame_rate: 15,
        audio: false,
      },
      camera_settings: cameraSettings,
      user_agent: navigator.userAgent,
    });

    sessionId = created.session_id;
    sessionLabel.textContent = sessionId;
    chunks = [];
    confusionIntervals = [];
    activeConfusion = null;
    activeInputSource = null;
    renderIntervals();

    const mimeType = chooseMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, {
      videoBitsPerSecond: 2_500_000,
      ...(mimeType ? { mimeType } : {}),
    });
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) chunks.push(event.data);
    });

    await new Promise((resolve, reject) => {
      mediaRecorder.addEventListener("start", resolve, { once: true });
      mediaRecorder.addEventListener(
        "error",
        (event) => reject(event.error || new Error("Failed to start recording")),
        { once: true }
      );
      mediaRecorder.start(1000);
    });

    sessionStartPerf = performance.now();
    captureStartedAtIso = new Date().toISOString();
    recording = true;
    startButton.blur();
    recordingBadge.classList.remove("hidden");
    statusText.textContent = "Recording";
    timer.textContent = "00:00.000";
    setMessage(
      "Collection started. Hold Space while confused and release it when the confusion ends."
    );
    readerScrollArea.scrollTop = 0;
    updateControls();
    timerHandle = window.setInterval(() => {
      timer.textContent = formatTime(performance.now() - sessionStartPerf);
    }, 50);
  } catch (error) {
    stopCameraTracks();
    recording = false;
    startButton.disabled = false;
    editContentButton.disabled = false;
    setMessage(`Could not start collection: ${error.message}`, "error");
  }
}

function beginConfusion(source = "keyboard_space") {
  if (!recording || activeConfusion) return;
  activeConfusion = {
    event_id: confusionIntervals.length + 1,
    start_time_ms: elapsedMs(),
    start_recorded_at_iso: new Date().toISOString(),
    input_source: source,
  };
  activeInputSource = source;
  markerFlash.textContent = "Confusion interval active";
  markerFlash.classList.remove("hidden");
  window.clearTimeout(flashHandle);
  renderIntervals();
}

function endConfusion(reason = "released", endTimeMs = elapsedMs()) {
  if (!activeConfusion) return;
  const safeEndTimeMs = Math.max(activeConfusion.start_time_ms, endTimeMs);
  confusionIntervals.push({
    ...activeConfusion,
    end_time_ms: safeEndTimeMs,
    duration_ms: safeEndTimeMs - activeConfusion.start_time_ms,
    end_recorded_at_iso: new Date().toISOString(),
    end_reason: reason,
  });
  activeConfusion = null;
  activeInputSource = null;
  markerFlash.textContent = "Confusion interval recorded";
  window.clearTimeout(flashHandle);
  flashHandle = window.setTimeout(
    () => markerFlash.classList.add("hidden"),
    900
  );
  renderIntervals();
}

function undoInterval() {
  if (!recording || activeConfusion || confusionIntervals.length === 0) return;
  confusionIntervals.pop();
  confusionIntervals.forEach((interval, index) => {
    interval.event_id = index + 1;
  });
  renderIntervals();
  setMessage("The last confusion interval was removed.");
}

function stopRecorder() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      resolve();
      return;
    }
    mediaRecorder.addEventListener("stop", resolve, { once: true });
    mediaRecorder.addEventListener(
      "error",
      (event) => reject(event.error || new Error("Failed to stop recording")),
      { once: true }
    );
    mediaRecorder.stop();
  });
}

function stopCameraTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  preview.srcObject = null;
}

async function stopCapture() {
  if (!recording) return;
  const durationMs = Math.round(performance.now() - sessionStartPerf);
  if (activeConfusion) {
    endConfusion("collection_stopped", durationMs);
  }
  const captureEndedAtIso = new Date().toISOString();
  const cameraSettings =
    mediaStream?.getVideoTracks?.()[0]?.getSettings?.() || {};
  const answers = collectAnswers();

  recording = false;
  window.clearInterval(timerHandle);
  timer.textContent = formatTime(durationMs);
  recordingBadge.classList.add("hidden");
  statusText.textContent = "Saving";
  updateControls();
  setMessage("Saving video, confusion intervals, and answers...");

  try {
    await stopRecorder();
    const recordingMimeType =
      mediaRecorder?.mimeType || chunks[0]?.type || "video/webm";
    const videoBlob = new Blob(chunks, { type: recordingMimeType });
    const videoResponse = await fetch(
      `/api/session/${encodeURIComponent(sessionId)}/video`,
      {
        method: "POST",
        headers: { "Content-Type": recordingMimeType },
        body: videoBlob,
      }
    );
    const videoPayload = await videoResponse.json().catch(() => ({}));
    if (!videoResponse.ok) {
      throw new Error(videoPayload.error || "Video upload failed");
    }

    const saved = await postJson(
      `/api/session/${encodeURIComponent(sessionId)}/intervals`,
      {
        intervals: confusionIntervals,
        answers,
        capture_started_at_iso: captureStartedAtIso,
        capture_ended_at_iso: captureEndedAtIso,
        duration_ms: durationMs,
        recording_mime_type: recordingMimeType,
        camera_settings: cameraSettings,
      }
    );
    statusText.textContent = "Saved";
    setMessage(
      `Saved to ${saved.relative_path} (${confusionIntervals.length} confusion intervals).`,
      "success"
    );
  } catch (error) {
    statusText.textContent = "Save failed";
    setMessage(`Save failed: ${error.message}`, "error");
  } finally {
    stopCameraTracks();
    cameraPlaceholder.classList.remove("hidden");
    mediaRecorder = null;
    chunks = [];
    sessionId = null;
    captureStartedAtIso = null;
    activeConfusion = null;
    activeInputSource = null;
    markerFlash.classList.add("hidden");
    markButton.classList.remove("active");
    markButton.textContent = "Hold to Mark Confusion";
    startButton.disabled = false;
    editContentButton.disabled = false;
    updateControls();
  }
}

addQuestionButton.addEventListener("click", () => createQuestionEditor());
confirmContentButton.addEventListener("click", confirmContent);
editContentButton.addEventListener("click", editContent);
startButton.addEventListener("click", startCapture);
markButton.addEventListener("pointerdown", (event) => {
  if (!recording) return;
  event.preventDefault();
  markButton.setPointerCapture?.(event.pointerId);
  beginConfusion("hold_button");
});
markButton.addEventListener("pointerup", (event) => {
  if (activeInputSource !== "hold_button") return;
  event.preventDefault();
  endConfusion("button_released");
  markButton.blur();
});
markButton.addEventListener("pointercancel", () => {
  if (activeInputSource === "hold_button") {
    endConfusion("pointer_cancelled");
  }
});
markButton.addEventListener("click", (event) => event.preventDefault());
undoButton.addEventListener("click", undoInterval);
stopButton.addEventListener("click", stopCapture);

savedMaterialSelect.addEventListener("change", updateTemplateButtons);

loadMaterialButton.addEventListener("click", () => {
  const template = selectedMaterialTemplate();
  if (!template) return;
  loadMaterialTemplate(template);
});

deleteMaterialButton.addEventListener("click", async () => {
  const template = selectedMaterialTemplate();
  if (!template) return;
  const shouldDelete = window.confirm(
    `Delete the locally saved material "${materialLabel(template)}"?`
  );
  if (!shouldDelete) return;
  deleteMaterialButton.disabled = true;
  try {
    await deleteMaterialTemplate(template.template_id);
  } catch (error) {
    window.alert(`Delete failed: ${error.message}`);
  } finally {
    updateTemplateButtons();
  }
});

exportMaterialButton.addEventListener("click", () => {
  const error = validateContent();
  if (error) {
    window.alert(error);
    return;
  }
  const template = buildMaterialTemplate();
  const safeName = (materialLabel(template) || "reading-material")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  downloadJson(`${safeName || "reading-material"}.json`, template);
});

textFileInput.addEventListener("change", async () => {
  const file = textFileInput.files?.[0];
  if (!file) return;
  readingTextInput.value = await file.text();
  if (!readingTitleInput.value.trim()) {
    readingTitleInput.value = file.name.replace(/\.[^.]+$/, "");
  }
  textFileInput.value = "";
});

materialFileInput.addEventListener("change", async () => {
  const file = materialFileInput.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    let imported = null;
    for (const candidate of candidates) {
      if (
        !candidate ||
        typeof candidate.reading_text !== "string" ||
        !Array.isArray(candidate.questions)
      ) {
        throw new Error("The JSON file is not a valid reading material.");
      }
      const template = {
        ...candidate,
        schema: "confusion-face-reading-material",
        version: 1,
        template_id: candidate.template_id || `material_${Date.now()}`,
        updated_at_iso: new Date().toISOString(),
      };
      imported = await saveMaterialTemplate(template);
    }
    if (imported) loadMaterialTemplate(imported);
  } catch (error) {
    window.alert(`Import failed: ${error.message}`);
  } finally {
    materialFileInput.value = "";
  }
});

fontDecreaseButton.addEventListener("click", () => {
  readingFontSize = Math.max(16, readingFontSize - 2);
  displayReadingText.style.fontSize = `${readingFontSize}px`;
});

fontIncreaseButton.addEventListener("click", () => {
  readingFontSize = Math.min(38, readingFontSize + 2);
  displayReadingText.style.fontSize = `${readingFontSize}px`;
});

window.addEventListener("keydown", (event) => {
  if (!recording || event.code !== "Space") return;
  const interactive = event.target.closest?.(
    "input, textarea, button, label"
  );
  if (interactive) return;
  event.preventDefault();
  if (event.repeat) return;
  beginConfusion("keyboard_space");
});

window.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || activeInputSource !== "keyboard_space") return;
  event.preventDefault();
  endConfusion("space_released");
});

window.addEventListener("blur", () => {
  if (recording && activeConfusion) {
    endConfusion("window_blurred");
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!recording) return;
  event.preventDefault();
  event.returnValue = "";
});

createQuestionEditor();
renderIntervals();
initializeSavedMaterials();
updateControls();
