const EVENTS = [
  { year: 1066, date: "14 октября", label: "Битва при Гастингсе" },
  { year: 1492, date: "12 октября", label: "Колумб достигает Америки" },
  { year: 1703, date: "16 мая", label: "Основание Санкт-Петербурга" },
  { year: 1776, date: "4 июля", label: "Декларация независимости США" },
  { year: 1789, date: "14 июля", label: "Взятие Бастилии" },
  { year: 1815, date: "18 июня", label: "Битва при Ватерлоо" },
  { year: 1895, date: "28 декабря", label: "Первый киносеанс братьев Люмьер" },
  { year: 1896, date: "6 апреля", label: "Открытие первых современных Олимпийских игр" },
  { year: 1903, date: "17 декабря", label: "Первый полёт братьев Райт" },
  { year: 1912, date: "15 апреля", label: "Гибель «Титаника»" },
  { year: 1945, date: "2 сентября", label: "Конец Второй мировой войны" },
  { year: 1957, date: "4 октября", label: "Запуск первого искусственного спутника Земли" },
  { year: 1961, date: "12 апреля", label: "Первый полёт человека в космос" },
  { year: 1969, date: "21 июля", label: "Высадка человека на Луну" },
  { year: 1989, date: "9 ноября", label: "Падение Берлинской стены" },
  { year: 1991, date: "6 августа", label: "Публикация первого веб-сайта" },
];

const CAPTION_STAGGER_MS = 32;
const CAPTION_DURATION_MS = 600;
const CAPTION_DELAY_MS = 280;
const TRAVEL_MS = window.timeTravelSky?.duration ?? 10400;
const FLIP_MS = 460;
const SCRAMBLE_DELAY_MS = 150;
const SETTLE_FRACTIONS = [0.7, 0.8, 0.9, 1];
const TICK_MIN_MS = 180;
const TICK_SLOWDOWN_MS = 320;
// Left to right: fast, faster, faster still, fastest.
const PACE = [1.55, 0.85, 0.48, 0.26];

const body = document.body;
const caption = document.querySelector(".caption");
const launchButton = document.querySelector(".nav-launch");
const launchLabel = launchButton.querySelector(".nav-launch-label");

const FLIP_CLICK_SRC = "/flip_sound.wav";
const MIN_CLICK_GAP_MS = 36;

const cards = [];
const glyphOffsets = new Map();
const flipClickBytes = fetch(FLIP_CLICK_SRC).then((response) => response.arrayBuffer());
let flipAudioCtx = null;
let flipBuffer = null;
let timers = [];
let target = null;
let travelStart = 0;
let travelMs = TRAVEL_MS;
let sceneCaption = "";
let pendingScene = null;

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const yearDigits = (year) => String(year).padStart(4, "0").split("");

function armFlipClicks() {
  if (!flipAudioCtx) flipAudioCtx = new AudioContext();
  if (flipAudioCtx.state === "suspended") flipAudioCtx.resume();
  if (flipBuffer) return;
  flipClickBytes
    .then((bytes) => flipAudioCtx.decodeAudioData(bytes.slice(0)))
    .then((buffer) => {
      flipBuffer = buffer;
    })
    .catch(() => {});
}

function playFlipClick(card, interval, force = false) {
  if (!flipBuffer || !flipAudioCtx || flipAudioCtx.state !== "running") return;
  const spinning = Math.min(cards.reduce((count, item) => count + (item.locked ? 0 : 1), 0) || 1, 4);
  const now = performance.now();
  const crowdGap = [0, 230, 140, 78, MIN_CLICK_GAP_MS][spinning];
  if (!force && now - card.lastClickAt < crowdGap) return;
  card.lastClickAt = now;

  const slow = force ? 1 : Math.min(Math.max(interval, 40) / 420, 1);
  const crowd = (spinning - 1) / 3;
  const energy = force ? 0 : crowd * (1 - slow * 0.5);
  const rate = (0.72 + energy * 0.86) * (0.93 + card.index * 0.04) * (0.97 + Math.random() * 0.06);
  const gainValue = force ? 0.52 : 0.24 + energy * 0.1;
  const cutoff = force ? 1200 : 700 + energy * 7000;

  const source = flipAudioCtx.createBufferSource();
  const filter = flipAudioCtx.createBiquadFilter();
  const gain = flipAudioCtx.createGain();
  source.buffer = flipBuffer;
  source.playbackRate.value = rate;
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  gain.gain.value = gainValue * 0.025;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(flipAudioCtx.destination);
  source.start();
}

function buildCard(el, index) {
  el.innerHTML = `
    <div class="card-glass"></div>
    <div class="card-tint"></div>
    <div class="half top"><span></span></div>
    <div class="half bottom"><span></span></div>
    <div class="leaf leaf-top"><span></span></div>
    <div class="leaf leaf-bottom"><span></span></div>`;
  const face = (selector) => el.querySelector(`${selector} span`);
  cards.push({
    el,
    top: face(".top"),
    bottom: face(".bottom"),
    leafTop: face(".leaf-top"),
    leafBottom: face(".leaf-bottom"),
    value: "",
    anims: [],
    locked: true,
    index,
    lastClickAt: 0,
  });
}

function measureBaseline(cardEl) {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:0;left:0;visibility:hidden;line-height:1;white-space:nowrap";
  probe.innerHTML = '0<i style="display:inline-block;width:0;height:0;vertical-align:baseline"></i>';
  cardEl.appendChild(probe);
  const baseline = probe.querySelector("i").getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return baseline;
}

function measureGlyphOffsets() {
  const cardEl = document.querySelector(".card");
  const style = getComputedStyle(cardEl);
  const size = parseFloat(style.fontSize);
  const baseline = measureBaseline(cardEl);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  for (let digit = 0; digit <= 9; digit++) {
    const m = ctx.measureText(String(digit));
    const inkCenterX = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const dx = (m.width / 2 - inkCenterX) / size;
    const dy = (size / 2 - baseline + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2) / size;
    glyphOffsets.set(String(digit), `${dx.toFixed(4)}em ${dy.toFixed(4)}em`);
  }
}

function setFace(span, value) {
  span.textContent = value;
  span.style.translate = glyphOffsets.get(value) ?? "";
}

function setInstant(card, value) {
  card.anims.forEach((a) => a.cancel());
  card.anims = [];
  card.value = value;
  setFace(card.top, value);
  setFace(card.bottom, value);
}

function flipTo(card, value, duration = FLIP_MS, interval = duration, force = false) {
  if (card.value === value) return;
  const old = card.value;
  card.anims.forEach((a) => a.cancel());
  card.value = value;
  setFace(card.top, value);
  setFace(card.bottom, old);
  setFace(card.leafTop, old);
  setFace(card.leafBottom, value);
  playFlipClick(card, interval, force);

  const half = duration / 2;
  const fall = card.leafTop.parentElement.animate(
    [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }],
    { duration: half, easing: "ease-in", fill: "forwards" },
  );
  const land = card.leafBottom.parentElement.animate(
    [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
    { duration: half, delay: half, easing: "ease-out", fill: "both" },
  );
  land.onfinish = () => {
    if (card.anims[1] !== land) return;
    setFace(card.bottom, value);
    fall.cancel();
    land.cancel();
    card.anims = [];
  };
  card.anims = [fall, land];
}

function schedule(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function travelProgress() {
  return (performance.now() - travelStart) / travelMs;
}

function lockIn(card, value) {
  if (card.value === value) playFlipClick(card, FLIP_MS, true);
  else flipTo(card, value, FLIP_MS, FLIP_MS, true);
  if (card.locked) return;
  card.locked = true;
  card.el.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
    { duration: 280, easing: "ease-out" },
  );
}

function randomDigitExcept(current) {
  const digit = String(randomInt(0, 8));
  return digit >= current ? String(Number(digit) + 1) : digit;
}

function scramble(card, settleFraction, finalValue) {
  card.locked = false;
  const tick = () => {
    const progress = Math.min(travelProgress() / settleFraction, 1);
    if (progress >= 1) {
      lockIn(card, finalValue);
      return;
    }
    const pace = PACE[card.index];
    const interval = (TICK_MIN_MS + TICK_SLOWDOWN_MS * progress ** 2) * pace * (0.82 + Math.random() * 0.36);
    const duration = Math.min(interval * 0.88, FLIP_MS * pace);
    flipTo(card, randomDigitExcept(card.value), duration, interval);
    schedule(tick, interval);
  };
  tick();
}

function clearCaption() {
  sceneCaption = "";
  caption.replaceChildren();
  caption.removeAttribute("aria-label");
}

function applyScene(scene) {
  if (!scene) return;
  if (Number.isInteger(scene.year)) {
    const digits = yearDigits(scene.year);
    if (cards.map((card) => card.value).join("") !== digits.join("")) {
      digits.forEach((digit, index) => lockIn(cards[index], digit));
    }
  }
  if (scene.caption && scene.caption !== sceneCaption) {
    sceneCaption = scene.caption;
    animateCaption(scene.caption);
  }
}

function showScene(scene) {
  pendingScene = {
    year: Number.isInteger(scene.year) ? scene.year : pendingScene?.year ?? null,
    caption: scene.caption || pendingScene?.caption || "",
  };
  if (body.classList.contains("is-traveling")) return;
  applyScene(pendingScene);
}

function animateCaption(text) {
  caption.replaceChildren();
  caption.setAttribute("aria-label", text);
  let index = 0;
  const rise = (span) => {
    span.animate(
      [
        { opacity: 0, transform: "translateY(40px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: CAPTION_DURATION_MS,
        delay: CAPTION_DELAY_MS + index * CAPTION_STAGGER_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      },
    );
    index += 1;
  };
  text.split(" ").forEach((word, wordIndex) => {
    if (wordIndex > 0) {
      const space = document.createElement("span");
      space.className = "split-char";
      space.setAttribute("aria-hidden", "true");
      space.textContent = "\u00A0";
      caption.appendChild(space);
      rise(space);
    }
    const wordEl = document.createElement("span");
    wordEl.className = "split-word";
    Array.from(word).forEach((char) => {
      const span = document.createElement("span");
      span.className = "split-char";
      span.setAttribute("aria-hidden", "true");
      span.textContent = char;
      wordEl.appendChild(span);
      rise(span);
    });
    caption.appendChild(wordEl);
  });
}

function launch() {
  if (body.classList.contains("is-traveling")) return;
  try {
    armFlipClicks();
  } catch (err) {
    console.error(err);
  }
  target = EVENTS[randomInt(0, EVENTS.length - 1)];
  pendingScene = null;
  clearCaption();
  body.classList.remove("is-arrived");
  body.classList.add("is-traveling");
  launchButton.disabled = true;
  window.timeTravelChat?.onDepart?.();
  window.timeTravelChat?.onLaunch?.(target);

  travelMs = TRAVEL_MS;
  travelStart = performance.now();
  window.timeTravelSky?.jump();
  schedule(arrive, travelMs);

  const digits = yearDigits(target.year);
  schedule(() => {
    cards.forEach((card) => {
      card.locked = false;
    });
    cards.forEach((card, i) => {
      schedule(() => scramble(card, SETTLE_FRACTIONS[i], digits[i]), i * 48 + randomInt(0, 160));
    });
  }, SCRAMBLE_DELAY_MS);
}

function arrive() {
  if (!body.classList.contains("is-traveling")) return;
  clearTimers();
  yearDigits(target.year).forEach((digit, i) => lockIn(cards[i], digit));
  body.classList.replace("is-traveling", "is-arrived");
  applyScene(pendingScene);
  launchButton.disabled = false;
  launchLabel.textContent = "Ещё раз";
  window.timeTravelChat?.onArrive?.(target);
}

window.timeTravelStage = { showScene };

document.querySelectorAll(".card").forEach(buildCard);
measureGlyphOffsets();
yearDigits(new Date().getFullYear()).forEach((digit, i) => setInstant(cards[i], digit));

launchButton.addEventListener("click", launch);
