const $ = (selector) => document.querySelector(selector);

const experimentSetup = $("#experimentSetup");
const subjectIdInput = $("#subjectId");
const readingIdInput = $("#readingId");
const notesInput = $("#notes");
const readingTitleInput = $("#readingTitle");
const readingTextInput = $("#readingText");
const textFileInput = $("#textFileInput");
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
let markers = [];
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
  undoButton.disabled = !recording || markers.length === 0;
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
  removeButton.textContent = "删除";
  header.append(label, removeButton);

  const questionInput = document.createElement("input");
  questionInput.className = "question-input";
  questionInput.placeholder = "输入题目";
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
    input.placeholder = `选项 ${letter}`;
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
      editor.querySelector("strong").textContent = `第 ${index + 1} 题`;
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
    return "请填写被试编号和阅读任务。";
  }
  if (!readingTextInput.value.trim()) {
    return "请粘贴或导入阅读文章。";
  }

  const questions = readQuestionsFromEditor();
  for (const [index, question] of questions.entries()) {
    if (!question.text) return `第 ${index + 1} 题缺少题目。`;
    const filledOptions = question.options.filter(Boolean);
    if (filledOptions.length < 2) {
      return `第 ${index + 1} 题至少需要两个选项。`;
    }
  }
  return "";
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
    empty.textContent = "本次阅读没有设置选择题。";
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

function confirmContent() {
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
  contentConfirmed = true;

  experimentSetup.classList.add("hidden");
  confirmedSummary.classList.remove("hidden");
  readerPanel.classList.remove("hidden");
  confirmedTitle.textContent =
    confirmedContent.reading_title || confirmedContent.reading_id;
  confirmedDetails.textContent = `${confirmedContent.reading_text.length} 个字符，${confirmedContent.questions.length} 道选择题。`;
  renderReading();
  window.scrollTo({ top: 0, behavior: "instant" });
  setMessage("内容已锁定。确认摄像头准备好后，点击“开始采集”。");
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

function renderMarkers() {
  markerCount.textContent = String(markers.length);
  markerList.replaceChildren();
  if (markers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "按空格后，时间点会显示在这里。";
    markerList.append(empty);
  } else {
    markers.forEach((marker) => {
      const item = document.createElement("li");
      item.textContent = `标注 ${marker.event_id} · ${formatTime(
        marker.press_time_ms
      )}`;
      markerList.append(item);
    });
    markerList.scrollTop = markerList.scrollHeight;
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
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}

async function startCapture() {
  if (!contentConfirmed || !confirmedContent) return;
  startButton.disabled = true;
  editContentButton.disabled = true;
  setMessage("正在请求摄像头权限……");

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
    markers = [];
    renderMarkers();

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
        (event) => reject(event.error || new Error("录像启动失败")),
        { once: true }
      );
      mediaRecorder.start(1000);
    });

    sessionStartPerf = performance.now();
    captureStartedAtIso = new Date().toISOString();
    recording = true;
    recordingBadge.classList.remove("hidden");
    statusText.textContent = "正在录制";
    timer.textContent = "00:00.000";
    setMessage("采集已开始。阅读、作答；感觉困惑时按一次空格。");
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
    setMessage(`无法开始采集：${error.message}`, "error");
  }
}

function addMarker() {
  if (!recording) return;
  markers.push({
    event_id: markers.length + 1,
    press_time_ms: Math.max(
      0,
      Math.round(performance.now() - sessionStartPerf)
    ),
    recorded_at_iso: new Date().toISOString(),
  });
  renderMarkers();
  markerFlash.classList.remove("hidden");
  window.clearTimeout(flashHandle);
  flashHandle = window.setTimeout(
    () => markerFlash.classList.add("hidden"),
    700
  );
}

function undoMarker() {
  if (!recording || markers.length === 0) return;
  markers.pop();
  markers.forEach((marker, index) => {
    marker.event_id = index + 1;
  });
  renderMarkers();
  setMessage("已撤销上一次困惑标注。");
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
      (event) => reject(event.error || new Error("录像停止失败")),
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
  const captureEndedAtIso = new Date().toISOString();
  const cameraSettings =
    mediaStream?.getVideoTracks?.()[0]?.getSettings?.() || {};
  const answers = collectAnswers();

  recording = false;
  window.clearInterval(timerHandle);
  timer.textContent = formatTime(durationMs);
  recordingBadge.classList.add("hidden");
  statusText.textContent = "正在保存";
  updateControls();
  setMessage("正在保存视频、标注和题目答案……");

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
      throw new Error(videoPayload.error || "视频上传失败");
    }

    const saved = await postJson(
      `/api/session/${encodeURIComponent(sessionId)}/markers`,
      {
        markers,
        answers,
        capture_started_at_iso: captureStartedAtIso,
        capture_ended_at_iso: captureEndedAtIso,
        duration_ms: durationMs,
        recording_mime_type: recordingMimeType,
        camera_settings: cameraSettings,
      }
    );
    statusText.textContent = "保存完成";
    setMessage(
      `保存成功：${saved.relative_path}（${markers.length} 个困惑标注）`,
      "success"
    );
  } catch (error) {
    statusText.textContent = "保存失败";
    setMessage(`保存失败：${error.message}`, "error");
  } finally {
    stopCameraTracks();
    cameraPlaceholder.classList.remove("hidden");
    mediaRecorder = null;
    chunks = [];
    sessionId = null;
    captureStartedAtIso = null;
    startButton.disabled = false;
    editContentButton.disabled = false;
    updateControls();
  }
}

addQuestionButton.addEventListener("click", () => createQuestionEditor());
confirmContentButton.addEventListener("click", confirmContent);
editContentButton.addEventListener("click", editContent);
startButton.addEventListener("click", startCapture);
markButton.addEventListener("click", addMarker);
undoButton.addEventListener("click", undoMarker);
stopButton.addEventListener("click", stopCapture);

textFileInput.addEventListener("change", async () => {
  const file = textFileInput.files?.[0];
  if (!file) return;
  readingTextInput.value = await file.text();
  if (!readingTitleInput.value.trim()) {
    readingTitleInput.value = file.name.replace(/\.[^.]+$/, "");
  }
  textFileInput.value = "";
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
  if (!recording || event.code !== "Space" || event.repeat) return;
  const interactive = event.target.closest?.(
    "input, textarea, button, label"
  );
  if (interactive) return;
  event.preventDefault();
  addMarker();
});

window.addEventListener("beforeunload", (event) => {
  if (!recording) return;
  event.preventDefault();
  event.returnValue = "";
});

createQuestionEditor();
renderMarkers();
updateControls();
