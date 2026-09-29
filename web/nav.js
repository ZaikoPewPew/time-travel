const NOTCH_OVERHANG = 16;
const NOTCH_RADIUS = 35;
const ARC_SEGMENTS = 14;
const SHADOW_BLEED = 40;
const MENU_CLOSE_DELAY_MS = 150;
const SVG_NS = "http://www.w3.org/2000/svg";

const nav = document.querySelector(".nav-root");
const navBar = nav.querySelector(".nav-bar");
const shell = nav.querySelector(".nav-shell");
const shadowSvg = shell.querySelector(".nav-notch-shadow");
const shadowMask = shadowSvg.querySelector("mask");
const shadowField = shadowSvg.querySelector("[data-field]");
const shadowCut = shadowSvg.querySelector("[data-cut]");
const shadowShape = shadowSvg.querySelector("[data-shape]");
const rimSvg = shell.querySelector(".nav-notch-rim");
const rimOutlines = rimSvg.querySelectorAll("[data-outline]");
const notchMask = shell.querySelector(".nav-notch-mask");
const menuToggle = nav.querySelector(".nav-menu-toggle");
const dropdown = nav.querySelector(".nav-dropdown");

let menuCloseTimer = 0;

function pushArc(points, cx, cy, r, fromDeg, toDeg) {
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / ARC_SEGMENTS) * Math.PI) / 180;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
}

function notchOutline(w, h) {
  const o = NOTCH_OVERHANG;
  const r = NOTCH_RADIUS;
  const points = [[w, 0]];
  pushArc(points, w, o, o, -90, -180);
  points.push([w - o, h - r]);
  pushArc(points, w - o - r, h - r, r, 0, 90);
  points.push([o + r, h]);
  pushArc(points, o + r, h - r, r, 90, 180);
  points.push([o, o]);
  pushArc(points, 0, o, o, 0, -90);
  return points;
}

const toSvgPoints = (points) => points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
const toClipPath = (points) => `polygon(${points.map(([x, y]) => `${x.toFixed(3)}px ${y.toFixed(3)}px`).join(", ")})`;

function setAttrs(el, attrs) {
  Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, String(value)));
}

function layoutNotch() {
  const w = shell.offsetWidth;
  const h = shell.offsetHeight;
  if (!w || !h) return;

  const outline = notchOutline(w, h);
  const shape = [[0, 0], ...outline];
  const shapePoints = toSvgPoints(shape);
  const viewBox = `0 0 ${w} ${h}`;
  const field = { x: -SHADOW_BLEED, y: -SHADOW_BLEED, width: w + SHADOW_BLEED * 2, height: h + SHADOW_BLEED * 2 };

  nav.style.setProperty("--nav-notch-clip", toClipPath(shape));

  shadowSvg.setAttribute("viewBox", viewBox);
  setAttrs(shadowMask, field);
  setAttrs(shadowField, field);
  shadowCut.setAttribute("points", shapePoints);
  shadowShape.setAttribute("points", shapePoints);

  rimSvg.setAttribute("viewBox", viewBox);
  rimOutlines.forEach((line) => line.setAttribute("points", toSvgPoints(outline)));

  const maskSvg = `<svg xmlns="${SVG_NS}" width="${w}" height="${h}"><polygon points="${shapePoints}" fill="white"/></svg>`;
  setAttrs(notchMask, { width: w, height: h, href: `data:image/svg+xml,${encodeURIComponent(maskSvg)}` });
}

function setMenuOpen(open) {
  clearTimeout(menuCloseTimer);
  if (open) {
    const toggleRect = menuToggle.getBoundingClientRect();
    const barRect = navBar.getBoundingClientRect();
    dropdown.style.left = `${toggleRect.left + toggleRect.width / 2 - barRect.left}px`;
  }
  menuToggle.setAttribute("aria-expanded", String(open));
  dropdown.classList.toggle("is-open", open);
}

function scheduleMenuClose() {
  clearTimeout(menuCloseTimer);
  menuCloseTimer = setTimeout(() => setMenuOpen(false), MENU_CLOSE_DELAY_MS);
}

const compactNav = window.matchMedia("(max-width: 767px)");

function closeMenuIfCompact() {
  if (compactNav.matches) setMenuOpen(false);
}

layoutNotch();
new ResizeObserver(layoutNotch).observe(shell);
compactNav.addEventListener("change", closeMenuIfCompact);

menuToggle.addEventListener("click", () => setMenuOpen(true));
[menuToggle, dropdown].forEach((el) => {
  el.addEventListener("mouseenter", () => setMenuOpen(true));
  el.addEventListener("mouseleave", scheduleMenuClose);
});
document.addEventListener("click", (event) => {
  if (!menuToggle.contains(event.target) && !dropdown.contains(event.target)) setMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuOpen(false);
});
