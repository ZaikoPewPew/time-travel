const PEEK_PX = 64;
const EDGE_PX = 24;

const panel = document.querySelector(".chat-panel");
const viewport = panel.querySelector(".chat-viewport");
const log = panel.querySelector(".chat-log");
const jump = panel.querySelector(".chat-jump");
const form = panel.querySelector(".chat-form");
const input = panel.querySelector(".chat-input");

const spacer = document.createElement("div");
spacer.className = "chat-spacer";
spacer.setAttribute("aria-hidden", "true");
log.appendChild(spacer);

const streams = new Map();
let anchorEl = null;
let holdAnchor = false;
let stickToEdge = true;
let ignoreScroll = false;
let frame = 0;
let messageSeq = 0;

function createId() {
  messageSeq += 1;
  return `m-${messageSeq}`;
}

function contentBottom() {
  return spacer.offsetTop;
}

function unreadBelow() {
  return contentBottom() - viewport.scrollTop - viewport.clientHeight > EDGE_PX;
}

function setScrollTop(value) {
  ignoreScroll = true;
  viewport.scrollTop = value;
  requestAnimationFrame(() => {
    ignoreScroll = false;
  });
}

function setSpacer(height) {
  const next = `${Math.max(0, Math.ceil(height))}px`;
  if (spacer.style.height !== next) spacer.style.height = next;
}

function pinToEnd() {
  setSpacer(0);
  setScrollTop(viewport.scrollHeight);
  updateJump();
}

function anchorTarget(row) {
  const previous = row.previousElementSibling;
  const peek = previous && previous.classList.contains("chat-message") ? PEEK_PX : 8;
  return Math.max(0, row.offsetTop - peek);
}

function applySpacerFor(target) {
  setSpacer(target + viewport.clientHeight - spacer.offsetTop);
}

function anchor(row) {
  anchorEl = row;
  holdAnchor = true;
  stickToEdge = false;
  const target = anchorTarget(row);
  applySpacerFor(target);
  setScrollTop(target);
  updateJump();
}

function updateJump() {
  const unread = unreadBelow();
  jump.inert = !unread;
  jump.tabIndex = unread ? 0 : -1;
  jump.dataset.active = unread ? "true" : "false";
  jump.setAttribute("aria-hidden", unread ? "false" : "true");
  viewport.dataset.following = stickToEdge ? "true" : "false";
}

function layout() {
  if (stickToEdge) {
    pinToEnd();
    return;
  }
  if (holdAnchor && anchorEl) {
    const top = viewport.scrollTop;
    applySpacerFor(anchorTarget(anchorEl));
    setScrollTop(top);
    const slack = contentBottom() - top - viewport.clientHeight;
    if (spacer.offsetHeight === 0 && slack <= 2) {
      holdAnchor = false;
      stickToEdge = true;
      if (slack < -2) pinToEnd();
    }
  }
  updateJump();
}

function scheduleLayout() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    layout();
  });
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").split("\n");
  const html = [];
  const paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph.length = 0;
    if (text) html.push(`<p>${inlineMarkdown(text)}</p>`);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      index += 1;
      continue;
    }
    if (/^---+$/.test(line)) {
      flushParagraph();
      html.push("<hr>");
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading && heading[2].trim()) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }
    const bullet = /^[-*]\s+\S/.test(line);
    const ordered = /^\d+\.\s+\S/.test(line);
    if (bullet || ordered) {
      flushParagraph();
      const items = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const matches = ordered ? /^\d+\.\s+\S/.test(current) : /^[-*]\s+\S/.test(current);
        if (!matches) break;
        const item = current.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
        items.push(`<li>${inlineMarkdown(item)}</li>`);
        index += 1;
      }
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return html.join("");
}

const MONTHS = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";

function cleanField(value) {
  return value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function readWhen(text) {
  const day = text.match(new RegExp(`(\\d{1,2}\\s+(?:${MONTHS}))`, "i"));
  const year = text.match(/\b(\d{3,4})\b/);
  return {
    day: day ? cleanField(day[1]) : "",
    year: year ? Number(year[1]) : null,
  };
}

function takeCaptionLine(text) {
  const complete = /(?:^|\n)[ \t]*CAPTION:[ \t]*(\d{3,4})[ \t]*\|[ \t]*([^|\n]*?)[ \t]*\|[ \t]*([^|\n]*?)[ \t]*\n/;
  const match = text.match(complete);
  if (match) {
    return {
      year: Number(match[1]),
      day: cleanField(match[2]),
      title: cleanField(match[3]),
      body: `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`,
    };
  }
  const stray = text.match(/(?:^|\n)[ \t]*CAPTION:[^\n]*(?:\n|$)/);
  if (!stray) return { year: null, day: "", title: "", body: text };
  return {
    year: null,
    day: "",
    title: "",
    body: `${text.slice(0, stray.index)}${text.slice(stray.index + stray[0].length)}`,
  };
}

function presentScene(raw, event, final = false) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const source = final && normalized && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
  const tagged = takeCaptionLine(source);
  const body = tagged.body.replace(/^\n+/, "");
  const problem = body.match(/^##[ \t]*проблема:[ \t]*([^\n]+)\n/im);
  const placeLine = body.match(/\*\*Год и место:\*\*[ \t]*([^\n]+)\n/);
  const place = placeLine ? readWhen(placeLine[1]) : { day: "", year: null };
  const title = cleanField(problem?.[1] || tagged.title || "");
  const day = place.day || tagged.day || (final ? event?.date || "" : "");
  const year = place.year || tagged.year || (final ? event?.year ?? null : null);
  return {
    year: Number.isInteger(year) ? year : null,
    caption: day && title ? `${day}, ${title}` : "",
    body,
  };
}

function scoreValue(text) {
  const match = text.match(/совпадение:\**\s*\**\s*(\d{1,3})\s*%/i);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

function scoreBand(value) {
  if (value >= 90) return "high";
  if (value >= 50) return "mid";
  if (value >= 10) return "low";
  return "fail";
}

function paintScore(row, text) {
  const value = scoreValue(text);
  let badge = row.querySelector(".chat-score");
  if (value === null) {
    badge?.remove();
    row.removeAttribute("data-score");
    return;
  }
  if (!badge) {
    badge = document.createElement("p");
    badge.className = "chat-score";
    row.querySelector(".chat-bubble").prepend(badge);
  }
  badge.dataset.band = scoreBand(value);
  badge.textContent = `Совпадение ${value}%`;
  row.dataset.score = String(value);
}

function paintMessage(node, role, text) {
  if (role === "assistant") {
    node.innerHTML = renderMarkdown(text);
    return;
  }
  node.textContent = text;
}

const LOGO_MARK = `<svg class="chat-pending-mark" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11.8179 0L13.2133 8.16605L19.5313 2.80747L15.3513 9.96L23.6356 9.91622L15.8359 12.7085L22.2102 18L14.4404 15.1255L15.9221 23.2763L11.8179 16.08L7.71363 23.2763L9.1953 15.1255L1.42557 18L7.79986 12.7085L0.000178337 9.91622L8.28449 9.96L4.10442 2.80747L10.4224 8.16605L11.8179 0Z" fill="currentColor"></path></svg>`;

function showPending(row) {
  const pending = document.createElement("div");
  pending.className = "chat-pending";
  pending.setAttribute("role", "status");
  pending.setAttribute("aria-label", "Ответ готовится");
  pending.innerHTML = LOGO_MARK;
  row.querySelector(".chat-bubble").prepend(pending);
}

function hidePending(row) {
  row?.querySelector(".chat-pending")?.remove();
}

function createRow(id, role, text) {
  const row = document.createElement("article");
  row.className = "chat-message";
  row.dataset.role = role;
  row.dataset.align = role === "user" ? "end" : "start";
  row.dataset.messageId = id;
  if (role === "user") row.dataset.anchor = "true";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  const body = document.createElement(role === "assistant" ? "div" : "p");
  body.className = "chat-message-text";
  if (role === "assistant") body.dataset.markdown = "true";
  paintMessage(body, role, text);
  bubble.appendChild(body);
  row.appendChild(bubble);
  return row;
}

function insertRow(row) {
  log.insertBefore(row, spacer);
}

function appendTurn({ id, role, text }) {
  const messageId = id || createId();
  const row = createRow(messageId, role, text);
  insertRow(row);
  if (role === "user") anchor(row);
  else scheduleLayout();
  return messageId;
}

const drafts = new Map();

function openStream(id, options = {}) {
  const row = createRow(id, "assistant", "");
  row.dataset.streaming = "true";
  if (options.opening) row.dataset.opening = "true";
  showPending(row);
  insertRow(row);
  streams.set(id, row.querySelector(".chat-message-text"));
  drafts.set(id, "");
  log.setAttribute("aria-busy", "true");
  scheduleLayout();
}

function publishScene(raw, final = false) {
  const scene = presentScene(raw, roundEvent, final);
  if (scene.caption || Number.isInteger(scene.year)) {
    window.timeTravelStage?.showScene({
      ...(scene.caption ? { caption: scene.caption } : {}),
      ...(Number.isInteger(scene.year) ? { year: scene.year } : {}),
    });
  }
  return scene;
}

function paintAssistant(node, raw, opening, final = false) {
  const row = node.closest(".chat-message");
  if (opening) {
    const scene = publishScene(raw, final);
    if (!scene.body.trim()) {
      if (row && !row.querySelector(".chat-pending")) showPending(row);
      node.innerHTML = "";
      return;
    }
    hidePending(row);
    node.innerHTML = renderMarkdown(scene.body);
    return;
  }
  hidePending(row);
  node.innerHTML = renderMarkdown(raw);
  paintScore(row, raw);
}

function pushChunk(id, text) {
  const node = streams.get(id);
  if (!node) return;
  const next = `${drafts.get(id) || ""}${text}`;
  drafts.set(id, next);
  const opening = node.closest(".chat-message")?.dataset.opening === "true";
  if (node.dataset.markdown === "true") paintAssistant(node, next, opening);
  else node.textContent = next;
  scheduleLayout();
}

function closeStream(id) {
  const node = streams.get(id);
  if (!node) return;
  const row = node.closest(".chat-message");
  const raw = drafts.get(id) || "";
  if (row?.dataset.opening === "true") {
    paintAssistant(node, raw, true, true);
    if (!node.innerHTML.trim()) row.remove();
  } else if (row) paintScore(row, raw);
  hidePending(row);
  row?.removeAttribute("data-streaming");
  streams.delete(id);
  drafts.delete(id);
  if (streams.size === 0) log.removeAttribute("aria-busy");
}

function clearLog() {
  log.querySelectorAll(".chat-message").forEach((row) => row.remove());
  streams.clear();
  drafts.clear();
  anchorEl = null;
  holdAnchor = false;
  stickToEdge = true;
  setSpacer(0);
  log.removeAttribute("aria-busy");
  updateJump();
}

viewport.addEventListener("scroll", () => {
  if (ignoreScroll) return;
  const top = viewport.scrollTop;
  holdAnchor = false;
  ignoreScroll = true;
  setSpacer(0);
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const next = Math.min(top, max);
  if (viewport.scrollTop !== next) viewport.scrollTop = next;
  stickToEdge = max - viewport.scrollTop <= EDGE_PX;
  requestAnimationFrame(() => {
    ignoreScroll = false;
  });
  updateJump();
}, { passive: true });

jump.addEventListener("click", () => {
  holdAnchor = false;
  stickToEdge = true;
  pinToEnd();
});

const sendButton = form.querySelector(".chat-send");
let sessionId = null;
let roundEvent = null;
let roundToken = 0;
let busy = false;
let activeAbort = null;

function setBusy(next) {
  busy = next;
  input.disabled = next;
  sendButton.disabled = next;
}

function finishAssistant(token, messageId) {
  if (token !== roundToken) return;
  closeStream(messageId);
  setBusy(false);
  if (panel.classList.contains("is-open")) input.focus();
}

async function readSse(url, payload, signal, token, messageId) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError" || token !== roundToken) return;
    pushChunk(messageId, "Не удалось связаться с локальным сервером.");
    return;
  }
  if (token !== roundToken) return;
  if (!response.ok || !response.body) {
    pushChunk(messageId, "Не удалось связаться с локальным сервером.");
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawText = false;
  try {
    while (token === roundToken) {
      const { value, done } = await reader.read();
      if (done || token !== roundToken) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data: "));
        if (!line || token !== roundToken) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.type === "session" && event.id) sessionId = event.id;
        if (event.type === "text" && event.text) {
          sawText = true;
          pushChunk(messageId, event.text);
        }
        if (event.type === "error" && event.message) {
          pushChunk(messageId, sawText ? `\n\n${event.message}` : event.message);
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError" || token !== roundToken) return;
    if (!sawText) pushChunk(messageId, "Не удалось связаться с локальным сервером.");
  }
}

function beginRound(event) {
  const token = ++roundToken;
  activeAbort?.abort();
  const previous = sessionId;
  sessionId = null;
  roundEvent = event;
  clearLog();
  setBusy(true);
  const messageId = createId();
  openStream(messageId, { opening: true });
  const controller = new AbortController();
  activeAbort = controller;
  readSse("/api/round", {
    year: event.year,
    date: event.date || "",
    label: event.label,
    sessionId: previous,
  }, controller.signal, token, messageId).finally(() => finishAssistant(token, messageId));
}

function onDepart() {
  activeAbort?.abort();
  roundToken += 1;
  roundEvent = null;
  clearLog();
  setBusy(true);
}

function onLaunch(event) {
  beginRound(event);
}

function onArrive(event) {
  if (roundEvent !== event) beginRound(event);
  setPanelOpen(true);
}

function ask(text) {
  const token = roundToken;
  setBusy(true);
  const messageId = createId();
  openStream(messageId);
  const controller = new AbortController();
  activeAbort = controller;
  readSse("/api/turn", { sessionId, text }, controller.signal, token, messageId)
    .finally(() => finishAssistant(token, messageId));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  appendTurn({ role: "user", text });
  if (!sessionId) {
    appendTurn({ role: "assistant", text: "Раунд не открыт. Запустите эпоху ещё раз." });
    return;
  }
  ask(text);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

new ResizeObserver(scheduleLayout).observe(log);
new ResizeObserver(scheduleLayout).observe(viewport);

const taskButton = document.querySelector(".nav-task");

function setPanelOpen(open) {
  const focusInside = panel.contains(document.activeElement);
  document.body.classList.toggle("is-chat-open", open);
  panel.classList.toggle("is-open", open);
  panel.inert = !open;
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  taskButton.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) input.focus();
  else if (focusInside) taskButton.focus();
}

taskButton.addEventListener("click", () => {
  setPanelOpen(!panel.classList.contains("is-open"));
});

document.addEventListener("pointerdown", (event) => {
  if (!panel.classList.contains("is-open")) return;
  if (panel.contains(event.target)) return;
  if (taskButton.contains(event.target)) return;
  setPanelOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panel.classList.contains("is-open")) {
    setPanelOpen(false);
  }
});

window.timeTravelChat = { appendTurn, openStream, pushChunk, closeStream, onLaunch, onArrive, onDepart, presentScene };
updateJump();
