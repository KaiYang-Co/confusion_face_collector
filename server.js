const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const MATERIALS_DIR = path.join(ROOT, "materials");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MATERIALS_DIR, { recursive: true });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sanitizePart(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

function isValidSessionId(value) {
  return /^[a-zA-Z0-9\u4e00-\u9fff_-]{1,140}$/.test(value);
}

function isValidTemplateId(value) {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function createSessionId(subjectId, readingId) {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");
  const suffix = crypto.randomBytes(2).toString("hex");
  return `${sanitizePart(subjectId, "subject")}_${sanitizePart(
    readingId,
    "reading"
  )}_${timestamp}_${suffix}`;
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeIntervalsCsv(filePath, intervals) {
  const rows = [
    [
      "event_id",
      "start_time_ms",
      "end_time_ms",
      "duration_ms",
      "start_recorded_at_iso",
      "end_recorded_at_iso",
      "input_source",
      "end_reason",
    ],
    ...intervals.map((interval) => [
      interval.event_id,
      interval.start_time_ms,
      interval.end_time_ms,
      interval.duration_ms,
      interval.start_recorded_at_iso,
      interval.end_recorded_at_iso,
      interval.input_source,
      interval.end_reason,
    ]),
  ];
  fs.writeFileSync(
    filePath,
    `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
    "utf8"
  );
}

function getSessionDir(sessionId) {
  if (!isValidSessionId(sessionId)) {
    throw new Error("Invalid session ID");
  }
  const sessionDir = path.resolve(DATA_DIR, sessionId);
  const dataRoot = `${path.resolve(DATA_DIR)}${path.sep}`;
  if (!`${sessionDir}${path.sep}`.startsWith(dataRoot)) {
    throw new Error("Invalid session path");
  }
  return sessionDir;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/materials") {
    try {
      const materials = fs
        .readdirSync(MATERIALS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => {
          try {
            return JSON.parse(
              fs.readFileSync(path.join(MATERIALS_DIR, entry.name), "utf8")
            );
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      sendJson(res, 200, { materials });
    } catch (error) {
      sendJson(res, 500, { error: `Failed to load materials: ${error.message}` });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/materials") {
    try {
      const body = await readJson(req, 5 * 1024 * 1024);
      if (typeof body.reading_text !== "string") {
        throw new Error("Reading text is required");
      }
      if (!Array.isArray(body.questions)) {
        throw new Error("Questions must be an array");
      }

      const templateId = isValidTemplateId(body.template_id)
        ? body.template_id
        : `material_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
      const material = {
        schema: "confusion-face-reading-material",
        version: 1,
        template_id: templateId,
        reading_id: String(body.reading_id || "").trim(),
        reading_title: String(body.reading_title || "").trim(),
        reading_text: body.reading_text,
        questions: body.questions,
        updated_at_iso: new Date().toISOString(),
      };
      writeJson(path.join(MATERIALS_DIR, `${templateId}.json`), material);
      sendJson(res, 201, {
        material,
        relative_path: `materials/${templateId}.json`,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const materialMatch = pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (req.method === "DELETE" && materialMatch) {
    try {
      const templateId = decodeURIComponent(materialMatch[1]);
      if (!isValidTemplateId(templateId)) {
        throw new Error("Invalid material ID");
      }
      const materialPath = path.join(MATERIALS_DIR, `${templateId}.json`);
      if (!fs.existsSync(materialPath)) {
        throw new Error("Material does not exist");
      }
      fs.rmSync(materialPath);
      sendJson(res, 200, { deleted: true, template_id: templateId });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/start") {
    try {
      const body = await readJson(req);
      const sessionId = createSessionId(body.subject_id, body.reading_id);
      const sessionDir = getSessionDir(sessionId);
      fs.mkdirSync(sessionDir, { recursive: false });

      writeJson(path.join(sessionDir, "metadata.json"), {
        session_id: sessionId,
        subject_id: String(body.subject_id || "").trim(),
        reading_id: String(body.reading_id || "").trim(),
        reading_title: String(body.reading_title || "").trim(),
        reading_text: String(body.reading_text || ""),
        questions: Array.isArray(body.questions) ? body.questions : [],
        notes: String(body.notes || "").trim(),
        server_created_at_iso: new Date().toISOString(),
        requested_capture: body.requested_capture || {},
        labeling_mode: "hold_space_confusion_interval",
        user_agent: String(body.user_agent || ""),
        status: "recording",
      });

      sendJson(res, 201, {
        session_id: sessionId,
        relative_path: `data/${sessionId}`,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const videoMatch = pathname.match(
    /^\/api\/session\/([^/]+)\/video$/
  );
  if (req.method === "POST" && videoMatch) {
    let sessionDir;
    try {
      sessionDir = getSessionDir(decodeURIComponent(videoMatch[1]));
      if (!fs.existsSync(sessionDir)) {
        throw new Error("Session does not exist");
      }
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const contentType = String(req.headers["content-type"] || "");
    const extension = contentType.includes("mp4") ? ".mp4" : ".webm";
    const finalPath = path.join(sessionDir, `face${extension}`);
    const tempPath = path.join(sessionDir, `face${extension}.uploading`);
    const output = fs.createWriteStream(tempPath, { flags: "w" });
    let bytesWritten = 0;
    let finished = false;

    req.on("data", (chunk) => {
      bytesWritten += chunk.length;
    });
    req.pipe(output);

    output.on("finish", () => {
      finished = true;
      fs.renameSync(tempPath, finalPath);
      sendJson(res, 201, {
        saved: true,
        file: path.basename(finalPath),
        bytes: bytesWritten,
      });
    });

    const cleanup = () => {
      if (!finished && fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }
    };

    req.on("aborted", cleanup);
    req.on("error", cleanup);
    output.on("error", (error) => {
      cleanup();
      if (!res.headersSent) {
        sendJson(res, 500, { error: `Failed to save video: ${error.message}` });
      }
    });
    return;
  }

  const intervalsMatch = pathname.match(
    /^\/api\/session\/([^/]+)\/intervals$/
  );
  if (req.method === "POST" && intervalsMatch) {
    try {
      const sessionId = decodeURIComponent(intervalsMatch[1]);
      const sessionDir = getSessionDir(sessionId);
      if (!fs.existsSync(sessionDir)) {
        throw new Error("Session does not exist");
      }

      const body = await readJson(req, 2 * 1024 * 1024);
      const intervals = Array.isArray(body.intervals) ? body.intervals : [];
      const invalidInterval = intervals.find(
        (interval) =>
          !Number.isFinite(interval.start_time_ms) ||
          !Number.isFinite(interval.end_time_ms) ||
          interval.start_time_ms < 0 ||
          interval.end_time_ms < interval.start_time_ms
      );
      if (invalidInterval) {
        throw new Error("Invalid confusion interval");
      }
      const validatedIntervals = intervals.map((interval, index) => ({
        ...interval,
        event_id: index + 1,
        duration_ms: interval.end_time_ms - interval.start_time_ms,
      }));
      writeJson(
        path.join(sessionDir, "confusion_intervals.json"),
        validatedIntervals
      );
      writeIntervalsCsv(
        path.join(sessionDir, "confusion_intervals.csv"),
        validatedIntervals
      );

      const metadataPath = path.join(sessionDir, "metadata.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      Object.assign(metadata, {
        capture_started_at_iso: body.capture_started_at_iso,
        capture_ended_at_iso: body.capture_ended_at_iso,
        duration_ms: body.duration_ms,
        recording_mime_type: body.recording_mime_type,
        camera_settings: body.camera_settings || {},
        answers: Array.isArray(body.answers) ? body.answers : [],
        interval_count: validatedIntervals.length,
        label_schema: {
          type: "confusion_intervals",
          start_field: "start_time_ms",
          end_field: "end_time_ms",
          time_origin: "recording_start",
        },
        status: "completed",
        server_completed_at_iso: new Date().toISOString(),
      });
      writeJson(metadataPath, metadata);

      sendJson(res, 201, {
        saved: true,
        interval_count: validatedIntervals.length,
        relative_path: `data/${sessionId}`,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "API endpoint not found" });
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const relative = decoded.replace(/^[/\\]+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  const publicRoot = `${path.resolve(PUBLIC_DIR)}${path.sep}`;

  if (!`${filePath}${path.sep}`.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = requestUrl.pathname;

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  serveStatic(res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Facial Confusion Data Collector: http://${HOST}:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Materials directory: ${MATERIALS_DIR}`);
  console.log("Press Ctrl+C to stop the server.");
});
