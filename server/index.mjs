import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Cursor } from "@cursor/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.CURSOR_MODEL || "auto";
const SKILL_PATH = path.join(ROOT, "SKILL.md");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
};

const sessions = new Map();

function nodeIsRecentEnough() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function skillPrompt() {
  const raw = readFileSync(SKILL_PATH, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
  const rules = body.replace(
    "Запусти первую случайную историческую эпоху прямо сейчас в этом формате!",
    "Эпоха уже выбрана. Открой вводную сцену именно для неё и не выбирай другую.",
  );
  return `Отвечай только текстом сцены и разбора в этом чате. Файлы, команды и инструменты не используй.\n\n${rules}`;
}

function destination(body) {
  const year = Number(body.year);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!Number.isInteger(year) || !label) return null;
  const when = date ? `${date} ${year}` : String(year);
  return { year, date, label, point: `${when}, ${label}` };
}

const SHAPE = "Оформи ответ Markdown: пустая строка между блоками, разделы заголовками ##, факты списками. Абзац — не длиннее двух предложений.";

const CAPTION_LINE = `Первая строка ответа — служебная, до любого заголовка, без Markdown, ровно в одну строку:
CAPTION: <год> | <день и месяц> | <короткое название>

Год, день и месяц возьми строго из точки назначения и не переноси сцену на другую дату. Короткое название — то же самое, слово в слово, что после «## ПРОБЛЕМА:». В тексте сцены эту строку не повторяй.`;

function kickoff(point, includeSkill) {
  const ask = `Точка назначения уже выбрана: ${point}. Открой вводную сцену строго по шаблону для этой точки. Не выбирай другую эпоху.

${CAPTION_LINE}

${SHAPE}`;
  return includeSkill ? `${skillPrompt()}\n\n${ask}` : ask;
}

function followup(point, text) {
  const where = point ? `Раунд идёт в точке: ${point}. Новую эпоху не открывай.\n\n` : "";
  return `${where}Ход игрока:
${text}

Если это вопрос об эпохе, материалах или сроках — ответь одним фактическим абзацем в 1–2 предложения. Без подсказки, без оценки и без новой сцены.

Если это план, действия или ответ на вопросы из «ТВОЙ ХОД» — проверь его по правилам и ответь разбором «## РАЗБОР». Строка «- **Совпадение:** N%» обязательна, N — целое от 0 до 100.

${SHAPE}`;
}

function agentOptions(systemPrompt) {
  return {
    ...(process.env.CURSOR_API_KEY ? { apiKey: process.env.CURSOR_API_KEY } : {}),
    model: { id: MODEL },
    tools: [],
    ...(systemPrompt ? { systemPrompt } : {}),
    local: {
      cwd: ROOT,
      settingSources: [],
    },
  };
}

function agentBinary() {
  if (process.env.CURSOR_AGENT_BIN) return process.env.CURSOR_AGENT_BIN;
  const local = process.env.HOME ? path.join(process.env.HOME, ".local/bin/agent") : "";
  if (local && existsSync(local)) return local;
  return "agent";
}

function cliReady() {
  return existsSync(agentBinary());
}

async function credentialsReady() {
  if (process.env.CURSOR_API_KEY) return true;
  try {
    const status = await Cursor.auth.status();
    return status.status === "logged-in";
  } catch {
    return false;
  }
}

function clientMessage(err) {
  const text = err instanceof Error ? err.message : String(err);
  if (/api key|unauthenticated|unauthorized|401/i.test(text)) {
    return "Ключ Cursor не принят. Проверьте CURSOR_API_KEY.";
  }
  return "Не удалось получить ответ.";
}

function writeEvent(res, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function disposeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.child && !session.child.killed) session.child.kill("SIGTERM");
  if (session.run?.supports?.("cancel")) {
    try {
      await session.run.cancel();
    } catch (err) {
      console.error(err);
    }
  }
  if (!session.agent) return;
  try {
    await session.agent[Symbol.asyncDispose]();
  } catch (err) {
    console.error(err);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function watchClient(res, session) {
  res.on("close", () => {
    if (res.writableEnded) return;
    if (session.child && !session.child.killed) session.child.kill("SIGTERM");
    if (session.run?.supports?.("cancel")) {
      session.run.cancel().catch((err) => console.error(err));
    }
  });
}

function runAgent(args) {
  return spawn(agentBinary(), args, {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createChat() {
  const child = runAgent(["create-chat"]);
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk) => {
    err += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      const id = out.trim();
      if (code !== 0 || !id) reject(new Error(err.trim() || "Не удалось открыть диалог."));
      else resolve(id);
    });
  });
}

function takeText(event) {
  if (event.type === "result" && typeof event.result === "string") return event.result;
  if (event.type !== "assistant") return "";
  const content = event.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function streamCli(res, session, prompt) {
  const child = runAgent([
    "-p",
    "--resume",
    session.chatId,
    "--mode",
    "ask",
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    ROOT,
    prompt,
  ]);
  session.child = child;
  watchClient(res, session);
  let buffer = "";
  let streamed = "";
  let failed = false;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const emitGrowth = (text) => {
    if (!text || text === streamed || streamed.startsWith(text)) return;
    const delta = text.startsWith(streamed) ? text.slice(streamed.length) : text;
    streamed = text.startsWith(streamed) ? text : streamed + text;
    if (delta) writeEvent(res, { type: "text", text: delta });
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "result" && event.is_error) {
        failed = true;
        writeEvent(res, { type: "error", message: event.result || "Не удалось получить ответ." });
        continue;
      }
      emitGrowth(takeText(event));
    }
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (session.child === child) session.child = null;
      if (!failed && !res.writableEnded) writeEvent(res, { type: "done" });
      resolve();
    };
    child.on("error", (err) => {
      console.error(err);
      failed = true;
      writeEvent(res, { type: "error", message: "Не удалось запустить агент Cursor." });
      finish();
    });
    child.on("close", (code) => {
      if (!failed && !streamed && !res.writableEnded) {
        failed = true;
        if (stderr.trim()) console.error(stderr.trim());
        writeEvent(res, {
          type: "error",
          message: code === 0 ? "Модель вернула пустой ответ." : "Модель не ответила. Запустите эпоху ещё раз.",
        });
      }
      finish();
    });
  });
}

async function streamRun(res, session, prompt, progress = { streamed: false }) {
  const run = await session.agent.send(prompt, {
    onDelta: ({ update }) => {
      if (update.type !== "text-delta" || !update.text) return;
      progress.streamed = true;
      writeEvent(res, { type: "text", text: update.text });
    },
  });
  session.run = run;
  watchClient(res, session);
  try {
    const result = await run.wait();
    if (result.status === "cancelled") {
      if (!res.writableEnded) writeEvent(res, { type: "error", message: "Ответ прерван." });
      return;
    }
    if (result.status === "error") {
      writeEvent(res, { type: "error", message: "Не удалось получить ответ." });
      return;
    }
    if (!progress.streamed && result.result) {
      progress.streamed = true;
      writeEvent(res, { type: "text", text: result.result });
    }
    writeEvent(res, { type: "done" });
  } finally {
    if (session.run === run) session.run = null;
  }
}

function promptDenied(err) {
  const text = err instanceof Error ? err.message : String(err);
  return /system-prompt/i.test(text);
}

async function handleRound(res, body) {
  if (typeof body.sessionId === "string" && body.sessionId) {
    await disposeSession(body.sessionId);
  }
  const useCli = !process.env.CURSOR_API_KEY && cliReady();
  if (!useCli && !(await credentialsReady())) {
    writeEvent(res, {
      type: "error",
      message: "Нет ключа Cursor. Запустите сервер с переменной CURSOR_API_KEY.",
    });
    return;
  }
  const place = destination(body);
  if (!place) {
    writeEvent(res, { type: "error", message: "Некорректная точка назначения." });
    return;
  }

  if (useCli) {
    const id = crypto.randomUUID();
    const chatId = await createChat();
    const session = { kind: "cli", chatId, child: null, point: place.point };
    sessions.set(id, session);
    writeEvent(res, { type: "session", id });
    await streamCli(res, session, kickoff(place.point, true));
    return;
  }

  const id = crypto.randomUUID();
  let agent = await Agent.create(agentOptions(skillPrompt()));
  const session = { agent, run: null, point: place.point };
  sessions.set(id, session);
  writeEvent(res, { type: "session", id });
  const progress = { streamed: false };

  try {
    await streamRun(res, session, kickoff(place.point, false), progress);
  } catch (err) {
    if (!promptDenied(err) || progress.streamed) throw err;
    console.error(err);
    await agent[Symbol.asyncDispose]().catch((disposeErr) => console.error(disposeErr));
    agent = await Agent.create(agentOptions(null));
    session.agent = agent;
    await streamRun(res, session, kickoff(place.point, true), progress);
  }
}

async function handleTurn(res, body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const session = typeof body.sessionId === "string" ? sessions.get(body.sessionId) : null;
  if (!session) {
    writeEvent(res, { type: "error", message: "Раунд уже закрыт. Запустите эпоху ещё раз." });
    return;
  }
  if (!text) {
    writeEvent(res, { type: "error", message: "Пустое сообщение." });
    return;
  }
  if (session.run || session.child) {
    writeEvent(res, { type: "error", message: "Подождите, ответ ещё печатается." });
    return;
  }
  const shaped = followup(session.point, text);
  if (session.kind === "cli") {
    await streamCli(res, session, shaped);
    return;
  }
  await streamRun(res, session, shaped);
}

function safeFile(urlPath) {
  const rel = decodeURIComponent(urlPath);
  const file = path.resolve(ROOT, `.${rel}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return null;
  const fromRoot = path.relative(ROOT, file);
  if (fromRoot.split(path.sep).some((part) => part.startsWith("."))) return null;
  if (fromRoot.split(path.sep).includes("node_modules")) return null;
  return file;
}

function serveFile(req, res, file) {
  const stat = statSync(file);
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

async function handleApi(req, res, pathname) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Некорректный запрос." }));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  try {
    if (pathname === "/api/round") await handleRound(res, body);
    else await handleTurn(res, body);
  } catch (err) {
    console.error(err);
    writeEvent(res, { type: "error", message: clientMessage(err) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function requestPath(req) {
  return new URL(req.url || "/", "http://localhost").pathname;
}

const server = createServer((req, res) => {
  const pathname = requestPath(req);
  if (req.method === "POST" && (pathname === "/api/round" || pathname === "/api/turn")) {
    handleApi(req, res, pathname).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      if (!res.writableEnded) res.end();
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  if (pathname === "/web") {
    res.writeHead(302, { Location: "/web/" });
    res.end();
    return;
  }
  const pathnameFile = pathname === "/" ? "/web/index.html" : pathname;
  const file = safeFile(pathnameFile.endsWith("/") ? `${pathnameFile}index.html` : pathnameFile);
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  serveFile(req, res, file);
});

if (!nodeIsRecentEnough()) {
  console.error(`Нужен Node.js 22.13 или новее, сейчас ${process.versions.node}.`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/web/`);
});

process.on("SIGINT", () => {
  Promise.all([...sessions.keys()].map((id) => disposeSession(id))).finally(() => process.exit(0));
});
