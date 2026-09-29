(() => {
  const TRAVEL_MS = 10400;
  const canvas = document.querySelector(".backdrop");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = motionQuery.matches;
  motionQuery.addEventListener("change", () => {
    reduceMotion = motionQuery.matches;
  });

  const idleStars = [];
  let warpStars = [];
  const meteors = [];

  let cssW = 0;
  let cssH = 0;
  let warpStart = 0;
  let warping = false;
  let reshuffled = false;
  let meteorIn = 2.6;
  let last = performance.now();
  let raf = 0;
  let active = true;

  function smoothstep(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function smootherstep(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function rgba(hue, alpha) {
    if (hue === "warm") return `rgba(255, 236, 214, ${alpha})`;
    if (hue === "blue") return `rgba(176, 206, 255, ${alpha})`;
    return `rgba(255, 255, 255, ${alpha})`;
  }

  function starTarget() {
    return Math.round(Math.min(700, Math.max(280, (cssW * cssH) / 5200)));
  }

  function makeIdleStar() {
    const roll = Math.random();
    const bright = roll > 0.975;
    const dust = roll < 0.78;
    const hueRoll = Math.random();
    return {
      x: Math.random() * cssW,
      y: Math.random() * cssH,
      r: bright ? 0.95 + Math.random() * 0.45 : dust ? 0.22 + Math.random() * 0.28 : 0.5 + Math.random() * 0.28,
      p1: Math.random() * Math.PI * 2,
      p2: Math.random() * Math.PI * 2,
      p3: Math.random() * Math.PI * 2,
      w1: 0.28 + Math.random() * 0.55,
      w2: 0.9 + Math.random() * 1.15,
      w3: 2.1 + Math.random() * 1.8,
      amp: bright ? 0.14 + Math.random() * 0.12 : dust ? 0.035 + Math.random() * 0.04 : 0.06 + Math.random() * 0.06,
      base: bright ? 0.84 + Math.random() * 0.16 : dust ? 0.22 + Math.random() * 0.2 : 0.48 + Math.random() * 0.24,
      depth: Math.random(),
      driftX: -(0.35 + Math.random() * 1.15),
      driftY: (Math.random() - 0.5) * 0.28,
      hue: hueRoll < 0.07 ? "warm" : hueRoll < 0.16 ? "blue" : "white",
      bright,
      dust,
    };
  }

  function makeWarpStar(x, y, depth = Math.random(), hue = Math.random() < 0.14 ? "warm" : "blue") {
    return {
      x,
      y,
      depth,
      hue,
      boost: 0.68 + Math.random() * 0.62,
      bright: Math.random() > 0.9,
      nx: 0,
      ny: 0,
      tail: 0,
      nose: 0,
      dist: 0,
    };
  }

  function respawnWarp(star) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 8 + Math.random() * 42;
    star.x = cssW / 2 + Math.cos(angle) * dist;
    star.y = cssH / 2 + Math.sin(angle) * dist;
    star.depth = Math.random();
    star.boost = 0.68 + Math.random() * 0.62;
    star.bright = Math.random() > 0.9;
    star.hue = Math.random() < 0.12 ? "warm" : "blue";
    star.tail = 0;
    star.nose = 0;
    star.nx = 0;
    star.ny = 0;
    star.dist = dist;
  }

  function borderSpan(nx, ny) {
    const hx = cssW * 0.5;
    const hy = cssH * 0.5;
    const tx = Math.abs(nx) > 0.0001 ? hx / Math.abs(nx) : 1e9;
    const ty = Math.abs(ny) > 0.0001 ? hy / Math.abs(ny) : 1e9;
    return Math.min(tx, ty);
  }

  function balanceIdleStars() {
    const target = starTarget();
    while (idleStars.length < target) idleStars.push(makeIdleStar());
    if (idleStars.length > target) idleStars.length = target;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (cssW > 0 && cssH > 0) {
      const sx = w / cssW;
      const sy = h / cssH;
      for (const star of idleStars) {
        star.x *= sx;
        star.y *= sy;
      }
      for (const star of warpStars) {
        star.x *= sx;
        star.y *= sy;
      }
    }
    cssW = w;
    cssH = h;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!warping) balanceIdleStars();
  }

  function seedWarp() {
    const reach = Math.hypot(cssW, cssH) * 0.5;
    const extra = Math.round(idleStars.length * 0.45);
    warpStars = idleStars.map((star) => makeWarpStar(star.x, star.y, star.depth, star.hue));
    for (let i = 0; i < extra; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() ** 0.5 * reach * 0.92;
      warpStars.push(makeWarpStar(cssW / 2 + Math.cos(angle) * dist, cssH / 2 + Math.sin(angle) * dist));
    }
  }

  function reshuffleIdle() {
    for (const star of idleStars) {
      star.x = Math.random() * cssW;
      star.y = Math.random() * cssH;
    }
    reshuffled = true;
  }

  function jump() {
    warpStart = performance.now();
    warping = true;
    reshuffled = false;
    meteors.length = 0;
    meteorIn = 1.4;
    if (reduceMotion) warpStars = [];
    else seedWarp();
  }

  function warpElapsed() {
    if (!warping) return null;
    const elapsed = performance.now() - warpStart;
    if (elapsed >= TRAVEL_MS) {
      warping = false;
      warpStars = [];
      return null;
    }
    return elapsed;
  }

  function envelope(travelT) {
    if (travelT == null || reduceMotion) return 0;
    const attack = smootherstep(0, 0.1, travelT);
    const release = 1 - smoothstep(0.66, 0.96, travelT);
    return attack * release;
  }

  function idlePresence(travelT) {
    if (travelT == null) return 1;
    const out = 1 - smoothstep(0.03, 0.16, travelT);
    const back = smoothstep(0.8, 0.98, travelT);
    return Math.max(out, back);
  }

  function warpPresence(travelT) {
    if (travelT == null || reduceMotion) return 0;
    return smootherstep(0.015, 0.13, travelT) * (1 - smoothstep(0.84, 1, travelT));
  }

  function flashLayers(elapsed) {
    if (elapsed == null) return null;
    const t = elapsed / 1000;
    if (t > 0.95) return null;
    const scale = reduceMotion ? 0.3 : 1;
    const rise = 1 - Math.exp(-t / 0.016);
    const core = Math.min(1, scale * rise * Math.exp(-t / 0.075) * 1.25);
    const bloom = scale * rise * Math.exp(-t / 0.19);
    const veil = scale * rise * Math.exp(-t / 0.11) * 0.2;
    const after = scale * (1 - Math.exp(-Math.max(0, t - 0.04) / 0.05)) * Math.exp(-Math.max(0, t - 0.04) / 0.42);
    if (core < 0.012 && bloom < 0.02 && veil < 0.012 && after < 0.02) return null;
    return { t, core, bloom, veil, after };
  }

  function spawnMeteor() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const angle = 0.28 + Math.random() * 0.42;
    const speed = 520 + Math.random() * 340;
    meteors.push({
      x: dir < 0 ? cssW + 24 : -24,
      y: Math.random() * cssH * 0.55,
      vx: Math.cos(angle) * speed * dir,
      vy: Math.sin(angle) * speed,
      len: 64 + Math.random() * 70,
      life: 0,
      ttl: 0.42 + Math.random() * 0.32,
    });
  }

  function stepMeteors(dt) {
    meteorIn -= dt;
    if (meteorIn <= 0) {
      spawnMeteor();
      meteorIn = 6.5 + Math.random() * 8;
    }
    for (let i = meteors.length - 1; i >= 0; i -= 1) {
      const meteor = meteors[i];
      meteor.x += meteor.vx * dt;
      meteor.y += meteor.vy * dt;
      meteor.life += dt;
      if (meteor.life > meteor.ttl || meteor.y > cssH + 40) meteors.splice(i, 1);
    }
  }

  function stepIdle(dt, visible) {
    if (!visible) return;
    for (const star of idleStars) {
      const depth = 0.35 + star.depth;
      star.x += star.driftX * depth * dt;
      star.y += star.driftY * depth * dt;
      if (star.x < -4) star.x = cssW + 4;
      if (star.x > cssW + 4) star.x = -4;
      if (star.y < -4) star.y = cssH + 4;
      if (star.y > cssH + 4) star.y = -4;
    }
    if (!reduceMotion) stepMeteors(dt);
  }

  function stepWarp(dt, env) {
    const cx = cssW / 2;
    const cy = cssH / 2;
    const margin = 80;
    for (const star of warpStars) {
      let dx = star.x - cx;
      let dy = star.y - cy;
      let dist = Math.hypot(dx, dy);
      if (dist < 1) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const nx = dx / dist;
      const ny = dy / dist;
      const velocity = env * (280 + dist * 2.5) * star.boost;
      star.x += nx * velocity * dt;
      star.y += ny * velocity * dt;
      star.nx = nx;
      star.ny = ny;
      star.dist = dist;
      const span = env * env * (3 - 2 * env);
      const edge = borderSpan(nx, ny);
      const reach = dist + edge;
      star.tail = dist * 0.22 * (1 - span) + reach * span;
      star.nose = Math.max(0, edge - dist) * span;
      if (star.x < -margin || star.y < -margin || star.x > cssW + margin || star.y > cssH + margin) {
        respawnWarp(star);
      }
    }
  }

  function fillCircle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(env) {
    const g = ctx.createRadialGradient(cssW / 2, cssH / 2, 0, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.72);
    const blue = Math.round(12 + env * 30);
    g.addColorStop(0, `rgb(${6 + env * 14}, ${8 + env * 18}, ${blue})`);
    g.addColorStop(0.48, "#04050a");
    g.addColorStop(1, "#020202");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function drawBand(presence, now) {
    if (presence < 0.02) return;
    const breathe = 0.62 + 0.38 * Math.sin(now * 0.00008);
    ctx.save();
    ctx.globalAlpha = presence * breathe;
    ctx.translate(cssW * 0.5, cssH * 0.46);
    ctx.rotate(-0.52);
    const g = ctx.createLinearGradient(0, -cssH * 0.15, 0, cssH * 0.15);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(0.5, "rgba(168, 186, 220, 0.05)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(-cssW, -cssH * 0.2, cssW * 2, cssH * 0.4);
    ctx.restore();
  }

  function starAlpha(star, seconds) {
    const slow = Math.sin(seconds * star.w1 + star.p1);
    const mid = Math.sin(seconds * star.w2 + star.p2);
    const fast = Math.sin(seconds * star.w3 + star.p3);
    const flick = slow * mid * 0.78 + fast * 0.22;
    const alpha = star.base * (1 + flick * star.amp);
    if (alpha < 0.04) return 0.04;
    if (alpha > 1) return 1;
    return alpha;
  }

  function drawIdle(presence, now) {
    if (presence < 0.02) return;
    const seconds = now * 0.001;
    ctx.save();
    ctx.globalAlpha = presence;
    ctx.lineCap = "round";
    for (const star of idleStars) {
      const alpha = starAlpha(star, seconds);
      if (star.bright) {
        const len = 2.4 + star.r * 2.8;
        ctx.strokeStyle = rgba(star.hue, alpha * 0.42);
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.moveTo(star.x - len, star.y);
        ctx.lineTo(star.x + len, star.y);
        ctx.moveTo(star.x, star.y - len * 0.68);
        ctx.lineTo(star.x, star.y + len * 0.68);
        ctx.stroke();
        ctx.fillStyle = rgba(star.hue, alpha * 0.12);
        fillCircle(star.x, star.y, star.r * 2.2);
      }
      ctx.fillStyle = rgba(star.hue, alpha);
      fillCircle(star.x, star.y, star.r);
    }
    ctx.restore();
  }

  function drawMeteors(presence) {
    if (presence < 0.2 || meteors.length === 0) return;
    ctx.save();
    ctx.globalAlpha = presence;
    ctx.lineCap = "round";
    for (const meteor of meteors) {
      const fade = Math.sin(Math.min(1, meteor.life / meteor.ttl) * Math.PI);
      const mag = Math.hypot(meteor.vx, meteor.vy) || 1;
      const tailX = meteor.x - (meteor.vx / mag) * meteor.len;
      const tailY = meteor.y - (meteor.vy / mag) * meteor.len;
      const g = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
      g.addColorStop(0, `rgba(255, 255, 255, ${fade})`);
      g.addColorStop(0.25, `rgba(198, 220, 255, ${fade * 0.45})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCore(env, now) {
    if (env < 0.03) return;
    const pulse = 0.86 + 0.14 * Math.sin(now * 0.009);
    const amount = env * pulse;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const rad = Math.min(cssW, cssH) * (0.06 + amount * 0.3);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255, 255, 255, ${0.82 * amount})`);
    g.addColorStop(0.15, `rgba(206, 224, 255, ${0.4 * amount})`);
    g.addColorStop(0.4, `rgba(96, 138, 255, ${0.1 * amount})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWarp(presence) {
    if (presence < 0.02 || warpStars.length === 0) return;
    warpStars.sort((a, b) => a.dist - b.dist);
    ctx.save();
    ctx.globalAlpha = presence;
    ctx.lineCap = "round";
    for (const star of warpStars) {
      if (star.tail < 2) continue;
      const alpha = star.bright ? 0.95 : 0.5 + star.depth * 0.38;
      const x0 = star.x - star.nx * star.tail;
      const y0 = star.y - star.ny * star.tail;
      const x1 = star.x + star.nx * star.nose;
      const y1 = star.y + star.ny * star.nose;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      const tint = star.hue === "warm" ? "255, 228, 206" : "214, 228, 255";
      const spanLen = star.tail + star.nose;
      const headT = spanLen > 0 ? Math.min(star.tail / spanLen, 0.999) : 0.999;
      g.addColorStop(0, `rgba(${tint}, 0)`);
      g.addColorStop(Math.min(0.14, headT * 0.5), `rgba(${tint}, ${alpha * 0.72})`);
      g.addColorStop(headT, `rgba(255, 255, 255, ${alpha})`);
      if (headT < 0.98) g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = star.bright ? 1.65 : 1.05;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShock(elapsed) {
    if (reduceMotion || elapsed == null) return;
    const t = elapsed / 1000;
    if (t < 0.02 || t > 0.72) return;
    const p = (t - 0.02) / 0.7;
    const fade = Math.exp(-p * 3.1) * (1 - Math.exp(-p * 8));
    if (fade < 0.02) return;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const rad = Math.max(8, p * Math.hypot(cssW, cssH) * 0.42);
    const band = 22 + p * 36;
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, rad - band), cx, cy, rad + band * 0.25);
    g.addColorStop(0, "rgba(200, 216, 255, 0)");
    g.addColorStop(0.62, `rgba(226, 236, 255, ${fade * 0.11})`);
    g.addColorStop(1, "rgba(160, 186, 240, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad + band, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFlash(elapsed) {
    const flash = flashLayers(elapsed);
    if (!flash) return;
    const { t, core, bloom, veil, after } = flash;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const reach = Math.hypot(cssW, cssH);

    if (veil > 0.015) {
      ctx.fillStyle = `rgba(226, 236, 255, ${Math.min(0.22, veil)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    if (after > 0.02) {
      const rad = reach * 0.58;
      const g = ctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
      g.addColorStop(0, `rgba(176, 198, 245, ${after * 0.14})`);
      g.addColorStop(0.45, `rgba(120, 142, 205, ${after * 0.045})`);
      g.addColorStop(1, "rgba(90, 110, 170, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    if (bloom > 0.02) {
      const rad = reach * (0.34 + Math.min(1, t / 0.18) * 0.22);
      const amount = Math.min(0.85, bloom);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(255, 255, 255, ${amount * 0.42})`);
      g.addColorStop(0.14, `rgba(214, 228, 255, ${amount * 0.22})`);
      g.addColorStop(0.36, `rgba(150, 178, 245, ${amount * 0.08})`);
      g.addColorStop(0.68, `rgba(110, 136, 210, ${amount * 0.025})`);
      g.addColorStop(1, "rgba(90, 110, 180, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    if (core > 0.02) {
      const rad = Math.min(cssW, cssH) * (0.07 + core * 0.11);
      const hot = Math.min(1, core);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(255, 255, 255, ${hot})`);
      g.addColorStop(0.18, `rgba(255, 248, 240, ${hot * 0.42})`);
      g.addColorStop(0.42, `rgba(206, 222, 255, ${hot * 0.12})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  function drawVignette(env) {
    const outer = Math.max(cssW, cssH) * 0.75;
    const g = ctx.createRadialGradient(cssW / 2, cssH / 2, outer * 0.28, cssW / 2, cssH / 2, outer);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, `rgba(0, 0, 0, ${0.32 + env * 0.38})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function frame(now) {
    if (!active) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;

    const elapsed = warpElapsed();
    const travelT = elapsed == null ? null : elapsed / TRAVEL_MS;
    if (elapsed != null && !reshuffled && elapsed > 1500) reshuffleIdle();

    const env = envelope(travelT);
    const idleA = idlePresence(travelT);
    const warpA = warpPresence(travelT);

    stepIdle(dt, idleA > 0.04 && env < 0.35);
    if (env > 0) stepWarp(dt, env);

    drawBackground(env);
    drawBand(idleA, now);
    drawIdle(idleA, now);
    drawMeteors(idleA);
    drawCore(env, now);
    drawWarp(warpA);
    drawShock(elapsed);
    drawVignette(env);
    drawFlash(elapsed);

    raf = requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    active = !document.hidden;
    if (!active) {
      cancelAnimationFrame(raf);
      return;
    }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  });

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  window.timeTravelSky = {
    duration: TRAVEL_MS,
    jump,
  };
})();
