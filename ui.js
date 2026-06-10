// =============================================================
// ui.js — Helpers compartidos de Locked In (páginas nuevas).
// Expone window.LIM:
//   - storeGet / storeSet            (JSON sobre localStorage → sync.js lo sincroniza)
//   - activeDateKey / lastNDates / fmtShort / fmtLong
//   - metricLog / metricGet / metricSeries / metricAvg  (métricas date→value)
//   - areaChart / hbar / heatmap / ringSVG              (gráficos SVG con glow)
// Sin dependencias. Las páginas originales no lo usan.
// =============================================================
(function () {
  'use strict';

  /* ---------------- Storage ---------------- */
  function storeGet(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? (fallback ?? null) : v;
    } catch (e) { return fallback ?? null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---------------- Fechas (corte del día a las 6 AM, igual que topbar/index) ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function activeDateKey() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return keyOf(d);
  }
  function lastNDates(n, endKey) {
    // n fechas ascendentes terminando en endKey (o el día activo)
    const end = endKey ? new Date(endKey + 'T12:00:00') : new Date(activeDateKey() + 'T12:00:00');
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      out.push(keyOf(d));
    }
    return out;
  }
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function fmtShort(key) {
    const d = new Date(key + 'T12:00:00');
    return d.getDate() + ' ' + MESES[d.getMonth()];
  }
  function fmtLong(key) {
    const d = new Date(key + 'T12:00:00');
    return DIAS[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()];
  }

  /* ---------------- Métricas genéricas ----------------
     Un doc por familia: lim_<ns>_v1 = { [tipo]: { [fecha]: valor } }   */
  function metricsDoc(ns) { return storeGet('lim_' + ns + '_v1', {}) || {}; }
  function metricLog(ns, type, value, dateKey) {
    const doc = metricsDoc(ns);
    if (!doc[type]) doc[type] = {};
    doc[type][dateKey || activeDateKey()] = value;
    storeSet('lim_' + ns + '_v1', doc);
  }
  function metricDelete(ns, type, dateKey) {
    const doc = metricsDoc(ns);
    if (doc[type]) { delete doc[type][dateKey]; storeSet('lim_' + ns + '_v1', doc); }
  }
  function metricGet(ns, type, dateKey) {
    const doc = metricsDoc(ns);
    const v = doc[type] ? doc[type][dateKey || activeDateKey()] : undefined;
    return v == null ? null : v;
  }
  function metricSeries(ns, type, days) {
    const doc = metricsDoc(ns);
    const map = doc[type] || {};
    return lastNDates(days).map((k) => ({ date: k, value: map[k] == null ? null : Number(map[k]) }));
  }
  function metricAvg(series) {
    const vals = series.map((p) => p.value).filter((v) => v != null && isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function metricLatest(ns, type, days) {
    const s = metricSeries(ns, type, days || 90);
    for (let i = s.length - 1; i >= 0; i--) if (s[i].value != null) return s[i];
    return null;
  }

  /* ---------------- Gráfico de área (sparkline con glow) ---------------- */
  let uid = 0;
  function areaChart(el, series, opts) {
    opts = opts || {};
    const color = opts.color || '#E07658';
    const H = opts.height || 120;
    const showAxis = opts.axis !== false;
    const W = Math.max(el.clientWidth || 600, 200);
    const padL = showAxis ? 34 : 4, padR = 8, padT = 10, padB = showAxis ? 20 : 4;
    const pts = series.filter((p) => p.value != null);
    if (pts.length < 2) {
      el.innerHTML = '<div class="chart-empty">Aún no hay suficientes datos — registra un par de días</div>';
      return;
    }
    const xs = series.map((_, i) => padL + (i / (series.length - 1)) * (W - padL - padR));
    let min = Math.min(...pts.map((p) => p.value));
    let max = Math.max(...pts.map((p) => p.value));
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.12; max += span * 0.12;
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

    // path solo por puntos con valor (saltando nulls con líneas continuas entre conocidos)
    let dLine = '', dArea = '';
    let firstX = null, lastX = null;
    series.forEach((p, i) => {
      if (p.value == null) return;
      const X = xs[i].toFixed(1), Y = y(p.value).toFixed(1);
      if (firstX == null) { firstX = X; dLine += `M${X},${Y}`; dArea += `M${X},${H - padB}L${X},${Y}`; }
      else { dLine += `L${X},${Y}`; dArea += `L${X},${Y}`; }
      lastX = X;
    });
    dArea += `L${lastX},${H - padB}Z`;

    const id = 'lim' + (++uid);
    const last = pts[pts.length - 1];
    const lastI = series.lastIndexOf(last);
    const axisLabels = showAxis
      ? `<text x="${padL - 6}" y="${y(max - span * 0.12) + 3}" text-anchor="end" class="chart-axis-label">${fmtNum(max - span * 0.12)}</text>
         <text x="${padL - 6}" y="${y(min + span * 0.12) + 3}" text-anchor="end" class="chart-axis-label">${fmtNum(min + span * 0.12)}</text>
         <text x="${xs[0]}" y="${H - 6}" class="chart-axis-label">${fmtShort(series[0].date)}</text>
         <text x="${W - padR}" y="${H - 6}" text-anchor="end" class="chart-axis-label">${fmtShort(series[series.length - 1].date)}</text>`
      : '';

    el.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block">
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
    <filter id="f${id}" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="${dArea}" fill="url(#g${id})"/>
  <path d="${dLine}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" filter="url(#f${id})"/>
  <circle cx="${xs[lastI]}" cy="${y(last.value)}" r="3.5" fill="${color}" filter="url(#f${id})"/>
  ${axisLabels}
</svg>`;
  }
  function fmtNum(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.abs(v) < 10 ? (+v.toFixed(1)).toString() : Math.round(v).toString();
  }

  /* ---------------- Barras horizontales ---------------- */
  function hbar(el, rows, opts) {
    opts = opts || {};
    if (!rows.length) { el.innerHTML = '<div class="chart-empty">Sin datos todavía</div>'; return; }
    const max = Math.max(...rows.map((r) => r.value), 1);
    el.innerHTML = rows.map((r) => `
<div class="hbar-row">
  <div class="hbar-head">
    <span class="hbar-name">${r.name}</span>
    <span class="hbar-val">${r.label != null ? r.label : r.value}</span>
  </div>
  <div class="hbar-track">
    <div class="hbar-fill" style="width:${((r.value / max) * 100).toFixed(1)}%;background:${r.color || '#E07658'};box-shadow:0 0 8px ${(r.color || '#E07658')}66"></div>
  </div>
</div>`).join('');
  }

  /* ---------------- Heatmap de consistencia (semanas × días) ---------------- */
  function heatmap(el, days, valueOf, opts) {
    opts = opts || {};
    const color = opts.color || '107, 227, 164'; // rgb
    const keys = lastNDates(days);
    // alinear a columnas semanales (lunes arriba)
    const cols = [];
    let col = new Array(7).fill(null);
    keys.forEach((k) => {
      const dow = (new Date(k + 'T12:00:00').getDay() + 6) % 7; // 0=lun
      col[dow] = k;
      if (dow === 6) { cols.push(col); col = new Array(7).fill(null); }
    });
    if (col.some((x) => x)) cols.push(col);
    const vals = keys.map(valueOf).filter((v) => v != null && v > 0);
    const vmax = vals.length ? Math.max(...vals) : 1;
    el.innerHTML = '<div class="heatmap">' + cols.map((c) =>
      '<div class="heatmap-col">' + c.map((k) => {
        if (!k) return '<div class="heatmap-cell" style="opacity:0"></div>';
        const v = valueOf(k);
        const a = v == null || v <= 0 ? 0 : 0.15 + 0.85 * Math.min(1, v / vmax);
        const bg = a === 0 ? 'rgba(255,255,255,0.045)' : `rgba(${color}, ${a.toFixed(2)})`;
        return `<div class="heatmap-cell" style="background:${bg}" title="${fmtLong(k)}${v != null ? ' · ' + v : ''}"></div>`;
      }).join('') + '</div>'
    ).join('') + '</div>';
  }

  /* ---------------- Anillo SVG ---------------- */
  function ringSVG(value, max, opts) {
    opts = opts || {};
    const size = opts.size || 120, stroke = opts.stroke || 9;
    const color = opts.color || '#E07658';
    const r = (size - stroke) / 2;
    const C = 2 * Math.PI * r;
    const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
    const id = 'ring' + (++uid);
    return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${stroke}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
    stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"
    transform="rotate(-90 ${size / 2} ${size / 2})" filter="url(#${id})"
    style="transition: stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1)"/>
</svg>`;
  }

  /* ---------------- Escala 0-100 (colores/labels estilo WHOOP) ---------------- */
  function scaleColor(v) {
    if (v == null) return '#76746E';
    if (v >= 67) return '#6BE3A4';
    if (v >= 34) return '#F2C063';
    return '#FF6B6B';
  }
  function scaleLabel(v) {
    if (v == null) return '—';
    if (v >= 80) return 'excelente';
    if (v >= 60) return 'bien';
    if (v >= 40) return 'normal';
    if (v >= 20) return 'bajo';
    return 'agotado';
  }

  /* ---------------- Delta helper ---------------- */
  function deltaHTML(cur, prev, opts) {
    opts = opts || {};
    if (cur == null || prev == null || prev === 0) return '<span class="delta flat">—</span>';
    const d = ((cur - prev) / Math.abs(prev)) * 100;
    if (Math.abs(d) < 0.5) return '<span class="delta flat">= igual</span>';
    const up = d > 0;
    const good = opts.goodWhenUp === false ? !up : up;
    return `<span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}% vs periodo previo</span>`;
  }

  window.LIM = {
    storeGet, storeSet,
    activeDateKey, lastNDates, fmtShort, fmtLong,
    metricLog, metricGet, metricDelete, metricSeries, metricAvg, metricLatest,
    areaChart, hbar, heatmap, ringSVG,
    scaleColor, scaleLabel, deltaHTML, fmtNum,
  };
})();
