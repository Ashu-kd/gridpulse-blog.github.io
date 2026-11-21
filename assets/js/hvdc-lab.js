/*!
 * GridPulse HVDC Controller Lab — UI layer (MIT)
 * Depends on: Chart.js 4, Lucide, KaTeX auto-render (optional), hvdc-models.js
 */
(function () {
  'use strict';
  const M = window.HVDCModels;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const isDark = () => document.documentElement.classList.contains('dark');
  const QS = new URLSearchParams(location.search);
  const EMBED = QS.get('embed');
  const C = { sky: '#0ea5e9', amber: '#f59e0b', emerald: '#10b981', rose: '#f43f5e', indigo: '#6366f1', violet: '#8b5cf6', slate: '#94a3b8', orange: '#f97316', teal: '#14b8a6', pink: '#ec4899' };
  const MODE_COLORS = ['rgba(0,0,0,0)', 'rgba(245,158,11,0.13)', 'rgba(244,63,94,0.20)', 'rgba(139,92,246,0.16)', 'rgba(100,116,139,0.22)'];
  const MODE_SOLID = [C.emerald, C.amber, C.rose, C.violet, C.slate];

  /* ------------------------------------------------------------------ utils */
  const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) { /* noop */ } };
  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }
  function copyText(text, msg) {
    const done = () => toast(msg || 'Copied');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { prompt('Copy this:', text); }
      ta.remove();
    }
  }
  function download(name, text, type = 'text/csv') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvOf(cols, series) {
    const keys = Object.keys(cols);
    const n = series[keys[0]].length;
    const lines = [keys.map(k => cols[k]).join(',')];
    for (let i = 0; i < n; i++) lines.push(keys.map(k => { const v = series[k][i]; return typeof v === 'number' ? +v.toPrecision(7) : v; }).join(','));
    return lines.join('\n');
  }
  const f = (v, d = 2, u = '') => (v === null || v === undefined || !isFinite(v) ? '—' : `${(+v).toFixed(d)}${u}`);
  const xy = (xs, ys, sx = 1, sy = 1) => { const o = new Array(xs.length); for (let i = 0; i < xs.length; i++) o[i] = { x: xs[i] * sx, y: ys[i] * sy }; return o; };
  const hline = (x0, x1, y) => [{ x: x0, y }, { x: x1, y }];
  const debounceRAF = fn => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };

  /* ------------------------------------------------------------- charts */
  const CHARTS = [];
  const themeColors = () => isDark()
    ? { grid: 'rgba(148,163,184,0.12)', tick: '#94a3b8', text: '#cbd5e1', cursor: '#e2e8f0' }
    : { grid: 'rgba(100,116,139,0.16)', tick: '#64748b', text: '#334155', cursor: '#0f172a' };

  const gpPlugin = {
    id: 'gp',
    beforeDatasetsDraw(chart, _a, opts) {
      const bands = opts && opts.bands; if (!bands || !bands.length) return;
      const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
      ctx.save();
      for (const b of bands) {
        const x0 = Math.max(left, x.getPixelForValue(b.x0)), x1 = Math.min(right, x.getPixelForValue(b.x1));
        if (x1 > x0) { ctx.fillStyle = b.color; ctx.fillRect(x0, top, x1 - x0, bottom - top); }
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart, _a, opts) {
      if (!opts || opts.cursor === null || opts.cursor === undefined) return;
      const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
      const px = x.getPixelForValue(opts.cursor); if (px < left || px > right) return;
      ctx.save(); ctx.strokeStyle = themeColors().cursor; ctx.globalAlpha = 0.7; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke(); ctx.restore();
    }
  };
  if (window.Chart) Chart.register(gpPlugin);

  function axis(cfg, tc, which) {
    const o = {
      type: cfg[which + 'Log'] ? 'logarithmic' : 'linear',
      title: { display: !!cfg[which + 'Title'], text: cfg[which + 'Title'], color: tc.text, font: { size: 11, weight: '600' } },
      ticks: { color: tc.tick, font: { size: 10 }, maxTicksLimit: which === 'x' ? 9 : 7 },
      grid: { color: tc.grid }
    };
    if (cfg[which + 'Min'] !== undefined) o.min = cfg[which + 'Min'];
    if (cfg[which + 'Max'] !== undefined) o.max = cfg[which + 'Max'];
    if (cfg[which + 'Tick']) o.ticks.callback = cfg[which + 'Tick'];
    return o;
  }

  function makeChart(id, cfg) {
    const el = document.getElementById(id); if (!el || !window.Chart) return null;
    const tc = themeColors();
    const scales = { x: axis(cfg, tc, 'x'), y: axis(cfg, tc, 'y') };
    if (cfg.y2Title || cfg.y2Min !== undefined) { scales.y2 = axis(cfg, tc, 'y2'); scales.y2.position = 'right'; scales.y2.grid = { drawOnChartArea: false, color: tc.grid }; }
    const datasets = cfg.datasets.map(d => ({
      label: d.label, data: [], borderColor: d.color, backgroundColor: d.bg || (d.color + '30'),
      borderWidth: d.width === undefined ? 2 : d.width, borderDash: d.dash || [], pointRadius: d.point || 0,
      pointHoverRadius: d.point ? d.point + 2 : 3, pointBackgroundColor: d.color, pointStyle: d.pointStyle || 'circle',
      fill: d.fill === undefined ? false : d.fill, stepped: d.stepped || false, showLine: d.showLine === undefined ? true : d.showLine,
      yAxisID: d.axis || 'y', tension: 0, order: d.order || 0, spanGaps: true
    }));
    const chart = new Chart(el.getContext('2d'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: cfg.legend !== false, labels: { color: tc.text, boxWidth: 12, boxHeight: 3, font: { size: 10 }, filter: it => !String(it.text).startsWith('_') } },
          tooltip: {
            filter: it => !String(it.dataset.label).startsWith('_'),
            callbacks: {
              title: items => items.length ? `${cfg.xLabel || 'x'} = ${(+items[0].parsed.x).toPrecision(4)}` : '',
              label: c => `${c.dataset.label}: ${(+c.parsed.y).toPrecision(4)}`
            }
          },
          gp: { bands: [], cursor: null }
        },
        scales
      }
    });
    CHARTS.push(chart);
    return chart;
  }
  function setData(chart, arrays) {
    if (!chart) return;
    arrays.forEach((d, i) => { if (chart.data.datasets[i] && d) chart.data.datasets[i].data = d; });
    chart.update('none');
  }
  function applyChartTheme() {
    const tc = themeColors();
    CHARTS.forEach(ch => {
      Object.values(ch.options.scales).forEach(s => { s.ticks.color = tc.tick; s.grid.color = tc.grid; if (s.title) s.title.color = tc.text; });
      ch.options.plugins.legend.labels.color = tc.text;
      ch.update('none');
    });
  }

  /* ----------------------------------------------------- control engine */
  const SELECT_CLS = 'w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5';
  function decimals(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }
  function itemHtml(mod, it) {
    const id = `${mod}-${it.id}`;
    if (it.type === 'check') {
      return `<label class="flex items-start gap-2.5 cursor-pointer py-0.5"><input type="checkbox" id="${id}" class="mt-0.5 w-4 h-4 rounded cursor-pointer accent-sky-500" ${it.value ? 'checked' : ''}/><span class="text-xs leading-snug"><span class="font-semibold">${it.label}</span>${it.hint ? `<span class="block text-[11px] text-slate-500">${it.hint}</span>` : ''}</span></label>`;
    }
    if (it.type === 'select') {
      return `<div><label for="${id}" class="block text-xs font-medium mb-0.5">${it.label}</label><select id="${id}" class="${SELECT_CLS}">${it.options.map(([v, l]) => `<option value="${v}" ${String(v) === String(it.value) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    }
    return `<div><div class="flex justify-between gap-2 text-xs font-medium mb-0.5"><label for="${id}" class="leading-snug">${it.label}</label><span id="${id}-v" class="font-mono font-semibold text-grid-600 dark:text-sky-400 whitespace-nowrap"></span></div><input id="${id}" type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${it.value}"/></div>`;
  }
  function buildControls(mod, rootSel, schema, onChange) {
    const root = $(rootSel); const flat = [];
    root.innerHTML = schema.map(g => {
      if (!g.items) { flat.push(g); return itemHtml(mod, g); }
      g.items.forEach(it => flat.push(it));
      return `<details class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50" ${g.open ? 'open' : ''}>
        <summary class="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><i data-lucide="chevron-right" class="chev w-3.5 h-3.5"></i>${g.title}</summary>
        <div class="px-3 pb-3 pt-1 space-y-2.5">${g.items.map(it => itemHtml(mod, it)).join('')}</div></details>`;
    }).join('');
    const defaults = {}; flat.forEach(it => { defaults[it.id] = it.value; });
    const label = it => {
      if (it.type === 'check' || it.type === 'select') return;
      const el = document.getElementById(`${mod}-${it.id}-v`); if (!el) return;
      const v = parseFloat(document.getElementById(`${mod}-${it.id}`).value);
      el.textContent = it.fmt ? it.fmt(v) : `${v.toFixed(decimals(it.step))}${it.unit ? ' ' + it.unit : ''}`;
    };
    const fire = debounceRAF(onChange);
    flat.forEach(it => {
      const el = document.getElementById(`${mod}-${it.id}`);
      el.addEventListener(it.type === 'range' || !it.type ? 'input' : 'change', () => { label(it); fire(); });
      label(it);
    });
    return {
      flat, defaults,
      get() {
        const o = {};
        flat.forEach(it => {
          const el = document.getElementById(`${mod}-${it.id}`);
          o[it.id] = it.type === 'check' ? el.checked : it.type === 'select' ? el.value : parseFloat(el.value);
        });
        return o;
      },
      set(vals, silent) {
        flat.forEach(it => {
          if (!(it.id in vals)) return;
          const el = document.getElementById(`${mod}-${it.id}`); let v = vals[it.id];
          if (it.type === 'check') el.checked = v === true || v === 'true' || v === '1' || v === 1;
          else el.value = v;
          label(it);
        });
        if (!silent) onChange();
      }
    };
  }
  function buildPresets(sel, presets, apply) {
    const root = $(sel); if (!root) return;
    root.innerHTML = presets.map((p, i) => `<button type="button" data-i="${i}" class="text-left px-2.5 py-2 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-grid-100 dark:bg-slate-800 dark:hover:bg-grid-950 border border-slate-200 dark:border-slate-700 transition-colors leading-snug">${p.name}${p.sub ? `<span class="block font-normal text-[10px] text-slate-500">${p.sub}</span>` : ''}</button>`).join('');
    $$('button', root).forEach(b => b.addEventListener('click', () => { apply(presets[+b.dataset.i]); toast(`Preset: ${presets[+b.dataset.i].name}`); }));
  }
  const TONE = { sky: 'text-grid-600 dark:text-sky-400', ok: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-rose-600 dark:text-rose-400', ind: 'text-indigo-600 dark:text-indigo-400', plain: 'text-slate-800 dark:text-slate-100' };
  function setKpis(mod, list) {
    const root = $(`[data-kpis="${mod}"]`); if (!root) return;
    root.innerHTML = list.map(k => `<div class="bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800 p-3 min-w-0">
      <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide truncate">${k.label}</div>
      <div class="text-base sm:text-lg font-mono font-bold mt-0.5 truncate ${TONE[k.tone || 'sky']}">${k.value}</div>
      ${k.sub ? `<div class="text-[10px] text-slate-500 font-mono truncate">${k.sub}</div>` : ''}</div>`).join('');
  }
  function setBanner(id, tone, html) {
    const el = document.getElementById(id); if (!el) return;
    if (!html) { el.classList.add('hidden'); return; }
    const cls = tone === 'bad' ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
      : tone === 'warn' ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200'
        : 'bg-sky-50 dark:bg-sky-950/50 border-sky-300 dark:border-sky-800 text-sky-800 dark:text-sky-200';
    el.className = `rounded-xl p-3.5 text-xs flex items-start gap-2.5 border ${cls}`;
    el.innerHTML = `<i data-lucide="${tone === 'bad' ? 'alert-triangle' : 'info'}" class="w-4 h-4 shrink-0 mt-0.5"></i><div>${html}</div>`;
    icons();
  }

  /* ------------------------------------------------------ share / embed */
  const MODULES = {};
  function stateQuery(mod) {
    const m = MODULES[mod]; if (!m || !m.ctl) return '';
    const v = m.ctl.get(), d = m.ctl.defaults, parts = [];
    Object.keys(v).forEach(k => { if (String(v[k]) !== String(d[k])) parts.push(`${k}=${encodeURIComponent(typeof v[k] === 'boolean' ? (v[k] ? 1 : 0) : v[k])}`); });
    return parts.join('&');
  }
  function shareUrl(mod) {
    const q = stateQuery(mod);
    return `${location.origin}${location.pathname}#m=${mod}${q ? '&' + q : ''}`;
  }
  function buildToolbar(mod, opts = {}) {
    const root = $(`[data-toolbar="${mod}"]`); if (!root) return;
    const btn = (act, icon, title) => `<button type="button" data-act="${act}" title="${title}" aria-label="${title}" class="p-1.5 rounded-lg text-slate-500 hover:text-grid-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800"><i data-lucide="${icon}" class="w-4 h-4"></i></button>`;
    root.innerHTML = btn('share', 'link', 'Copy a link to this exact scenario') + btn('embed', 'code-2', 'Copy embed code for an article') + (opts.csv ? btn('csv', 'download', 'Download results as CSV') : '') + btn('reset', 'rotate-ccw', 'Reset to defaults');
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const m = MODULES[mod];
      if (b.dataset.act === 'share') { const u = shareUrl(mod); history.replaceState(null, '', u.slice(u.indexOf('#'))); copyText(u, 'Scenario link copied'); }
      if (b.dataset.act === 'embed') { const q = stateQuery(mod); copyText(`{% include sim.html module="${mod}"${q ? ` params="${q}"` : ''} %}`, 'Embed snippet copied — paste it into an article'); }
      if (b.dataset.act === 'csv' && opts.csv) opts.csv();
      if (b.dataset.act === 'reset') { m.ctl.set(m.ctl.defaults); toast('Reset to defaults'); }
    });
  }
  function parseHash() {
    const h = location.hash.replace(/^#/, ''); if (!h) return null;
    const sp = new URLSearchParams(h); const o = {}; sp.forEach((v, k) => { o[k] = v; });
    return o;
  }

  /* ================================================================
     MODULE 1 — POLE CONTROL
  ================================================================ */
  function initPole() {
    const schema = [
      { title: 'Current controllers', open: true, items: [
        { id: 'Kp', label: 'Rectifier K<sub>p</sub>', min: 0.2, max: 40, step: 0.1, value: 6.8, unit: 'rad/pu' },
        { id: 'Ti', label: 'Rectifier T<sub>i</sub>', min: 2, max: 120, step: 1, value: 28, unit: 'ms' },
        { id: 'KpI', label: 'Inverter CC K<sub>p</sub>', min: 0.1, max: 10, step: 0.1, value: 0.8, unit: 'rad/pu' },
        { id: 'TiI', label: 'Inverter CC T<sub>i</sub>', min: 5, max: 120, step: 1, value: 20, unit: 'ms' },
        { id: 'margin', label: 'Current margin ΔI', min: 0.05, max: 0.2, step: 0.01, value: 0.1, unit: 'pu' },
        { id: 'alphaMin', label: 'α<sub>min</sub>', min: 2, max: 20, step: 1, value: 5, unit: '°' },
        { id: 'gammaRef', label: 'γ<sub>ref</sub> (CEA)', min: 12, max: 30, step: 0.5, value: 18, unit: '°' },
        { id: 'Td', label: 'Firing dead time T<sub>d</sub>', min: 0, max: 3, step: 0.01, value: 0.83, unit: 'ms' }
      ] },
      { title: 'VDCOL', items: [
        { id: 'vdcol', type: 'check', label: 'Enable VDCOL', value: true, hint: 'Voltage-dependent current-order limiter' },
        { id: 'vHigh', label: 'V<sub>d,high</sub>', min: 0.5, max: 1, step: 0.05, value: 0.8, unit: 'pu' },
        { id: 'vLow', label: 'V<sub>d,low</sub>', min: 0.1, max: 0.5, step: 0.05, value: 0.3, unit: 'pu' },
        { id: 'iMin', label: 'I<sub>ord,min</sub>', min: 0.1, max: 0.6, step: 0.05, value: 0.3, unit: 'pu' }
      ] },
      { title: 'Power order', open: true, items: [
        { id: 'P0', label: 'Initial power P<sub>0</sub>', min: 0.2, max: 1.1, step: 0.05, value: 1.0, unit: 'pu' },
        { id: 'rampOn', type: 'check', label: 'Change power order', value: true },
        { id: 'P1', label: 'New power order P<sub>1</sub>', min: 0.1, max: 1.1, step: 0.05, value: 0.7, unit: 'pu' },
        { id: 'rampT', label: 'Order change at', min: 20, max: 800, step: 10, value: 100, unit: 'ms' },
        { id: 'rate', label: 'Ramp rate (100 ≈ step)', min: 0.5, max: 100, step: 0.5, value: 5, unit: 'pu/s' }
      ] },
      { title: 'Rectifier AC disturbance', items: [
        { id: 'rdOn', type: 'check', label: 'Rectifier AC voltage dip', value: false },
        { id: 'rdT', label: 'Start', min: 20, max: 900, step: 10, value: 250, unit: 'ms' },
        { id: 'rdDur', label: 'Duration', min: 10, max: 600, step: 10, value: 200, unit: 'ms' },
        { id: 'rdDepth', label: 'Depth', min: 0.02, max: 0.6, step: 0.01, value: 0.2, fmt: v => `${(v * 100).toFixed(0)} %` }
      ] },
      { title: 'Inverter AC fault & CF prevention', items: [
        { id: 'idOn', type: 'check', label: 'Inverter AC fault', value: false },
        { id: 'idT', label: 'Start', min: 20, max: 900, step: 10, value: 250, unit: 'ms' },
        { id: 'idDur', label: 'Duration', min: 10, max: 400, step: 10, value: 100, unit: 'ms' },
        { id: 'idDepth', label: 'Voltage dip', min: 0.02, max: 0.8, step: 0.01, value: 0.15, fmt: v => `${(v * 100).toFixed(0)} %` },
        { id: 'idPhi', label: 'Phase jump φ (asymmetry)', min: -10, max: 0, step: 0.5, value: 0, unit: '°' },
        { id: 'gammaCF', label: 'γ<sub>min</sub> for CF', min: 4, max: 12, step: 0.1, value: 7.2, unit: '°' },
        { id: 'cfpOn', type: 'check', label: 'CF prevention (CFPREV)', value: false, hint: 'Adds γ on detected dip / phase jump' },
        { id: 'cfpGain', label: 'CFPREV gain', min: 10, max: 150, step: 5, value: 60, unit: '°/pu' }
      ] },
      { title: 'DC line fault', items: [
        { id: 'dfOn', type: 'check', label: 'DC line-to-ground fault', value: false },
        { id: 'dfT', label: 'Fault inception', min: 20, max: 900, step: 10, value: 250, unit: 'ms' },
        { id: 'dfX', label: 'Location (from rectifier)', min: 0.05, max: 0.95, step: 0.05, value: 0.5, fmt: v => `${(v * 100).toFixed(0)} %` },
        { id: 'dfRf', label: 'Fault resistance R<sub>f</sub>', min: 0.005, max: 0.3, step: 0.005, value: 0.02, unit: 'pu' },
        { id: 'dfDeion', label: 'Deionisation time', min: 50, max: 500, step: 10, value: 150, unit: 'ms' },
        { id: 'dfPerm', type: 'check', label: 'Permanent fault', value: false, hint: 'Restarts are attempted, then the pole blocks' }
      ] },
      { title: 'DC circuit & simulation', items: [
        { id: 'L', label: 'DC inductance L (L/Z<sub>base</sub>)', min: 2, max: 50, step: 0.5, value: 10, unit: 'ms' },
        { id: 'Rd', label: 'DC resistance R<sub>d</sub>', min: 0.005, max: 0.1, step: 0.005, value: 0.03, unit: 'pu' },
        { id: 'dx', label: 'Relative inductive drop d<sub>x</sub>', min: 0.04, max: 0.12, step: 0.005, value: 0.08, unit: 'pu' },
        { id: 'T', label: 'Simulated time', min: 0.3, max: 2, step: 0.1, value: 1.0, unit: 's' }
      ] }
    ];
    const toParams = v => ({
      T: v.T, L: v.L / 1000, Rd: v.Rd, dx: v.dx, alphaMin: v.alphaMin, gammaRef: v.gammaRef, gammaCF: v.gammaCF,
      margin: v.margin, Kp: v.Kp, Ti: v.Ti / 1000, KpI: v.KpI, TiI: v.TiI / 1000, Td: v.Td / 1000,
      vdcol: { on: v.vdcol, Vhigh: v.vHigh, Vlow: Math.min(v.vLow, v.vHigh - 0.05), Imin: v.iMin },
      P0: v.P0, ramp: { on: v.rampOn, t: v.rampT / 1000, P1: v.P1, rate: v.rate },
      rectDip: { on: v.rdOn, t: v.rdT / 1000, dur: v.rdDur / 1000, depth: v.rdDepth },
      invDip: { on: v.idOn, t: v.idT / 1000, dur: v.idDur / 1000, depth: v.idDepth, phi: v.idPhi },
      dcFault: { on: v.dfOn, t: v.dfT / 1000, x: v.dfX, Rf: v.dfRf, deion: v.dfDeion / 1000, permanent: v.dfPerm },
      cfPrev: { on: v.cfpOn, gain: v.cfpGain }
    });
    const off = { rampOn: false, rdOn: false, idOn: false, dfOn: false, cfpOn: false, dfPerm: false, idPhi: 0 };
    const presets = [
      { name: 'Power ramp', sub: '1.0 → 0.7 pu at 5 pu/s', v: { ...off, rampOn: true, P1: 0.7, rate: 5, T: 1 } },
      { name: 'Order step', sub: 'large-signal α limits', v: { ...off, rampOn: true, P1: 0.6, rate: 100, T: 0.5 } },
      { name: 'Rectifier AC dip', sub: '20 % → mode shift', v: { ...off, rdOn: true, rdT: 250, rdDur: 200, rdDepth: 0.2, T: 1 } },
      { name: 'Inverter AC fault', sub: '30 % dip → CF + VDCOL', v: { ...off, idOn: true, idT: 250, idDur: 100, idDepth: 0.3, T: 1 } },
      { name: 'Asymmetrical fault', sub: '10 %, φ = −6° → repeated CF', v: { ...off, idOn: true, idT: 250, idDur: 150, idDepth: 0.1, idPhi: -6, T: 1 } },
      { name: '… with CFPREV', sub: 'same fault, prevention on', v: { ...off, idOn: true, idT: 250, idDur: 150, idDepth: 0.1, idPhi: -6, cfpOn: true, T: 1 } },
      { name: 'DC line fault', sub: 'retard, deionise, restart', v: { ...off, dfOn: true, dfT: 250, T: 1 } },
      { name: 'Permanent DC fault', sub: '2 restarts → block', v: { ...off, dfOn: true, dfPerm: true, dfT: 200, T: 1.5 } },
      { name: 'Aggressive gains', sub: 'K_p 15, T_i 6 ms (PM≈25°)', v: { ...off, rampOn: true, P1: 0.9, rate: 100, Kp: 15, Ti: 6, T: 0.5 } },
      { name: 'Slow, CIGRE-like', sub: 'K_p 1.1, T_i 11 ms', v: { ...off, rampOn: true, P1: 0.9, rate: 100, Kp: 1.1, Ti: 11, T: 1 } }
    ];

    const ch = {
      i: makeChart('ch-pole-i', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'current [pu]', datasets: [
        { label: 'I_ord', color: C.slate, dash: [5, 4], width: 1.5 },
        { label: 'I_d rectifier', color: C.sky },
        { label: 'I_d inverter', color: C.indigo, width: 1.2, dash: [2, 2] },
        { label: '_margin', color: C.amber, width: 1, dash: [2, 4] }
      ] }),
      v: makeChart('ch-pole-v', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'DC voltage [pu]', datasets: [
        { label: 'V_dr', color: C.sky }, { label: 'V_di', color: C.amber }
      ] }),
      a: makeChart('ch-pole-a', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'angle [°]', datasets: [
        { label: 'α rectifier', color: C.sky }, { label: 'γ inverter', color: C.amber },
        { label: 'γ_min (CF)', color: C.rose, dash: [5, 4], width: 1.2 }, { label: 'β inverter', color: C.violet, width: 1, dash: [3, 3] }
      ] }),
      p: makeChart('ch-pole-p', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'power [pu]', y2Title: 'AC voltage factor', y2Min: 0, y2Max: 1.1, datasets: [
        { label: 'P_d', color: C.emerald }, { label: 'P_ord', color: C.slate, dash: [5, 4], width: 1.2 },
        { label: 'k_r (rect AC)', color: C.sky, width: 1, axis: 'y2', stepped: true }, { label: 'k_i (inv AC)', color: C.amber, width: 1, axis: 'y2', stepped: true }
      ] })
    };
    $('#pole-legend').innerHTML = M.MODE_LABELS.map((l, i) => `<span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm" style="background:${i === 0 ? 'transparent' : MODE_COLORS[i].replace(/0\.\d+\)/, '0.55)')};border:1px solid ${MODE_SOLID[i]}"></span>${l}</span>`).join('');
    $('#pole-diagram').innerHTML = poleDiagramSvg();

    let res = null;
    function run() {
      const v = ctl.get();
      res = M.simPoleControl(toParams(v));
      const s = res.series, k = res.kpi, T = s.t[s.t.length - 1] * 1000;
      const bands = []; let cur = s.mode[0], x0 = 0;
      for (let i = 1; i <= s.t.length; i++) {
        const m = i < s.t.length ? s.mode[i] : -1;
        if (m !== cur) { if (cur > 0) bands.push({ x0: s.t[x0] * 1000, x1: s.t[i - 1] * 1000, color: MODE_COLORS[cur] }); cur = m; x0 = i; }
      }
      Object.values(ch).forEach(c => { if (c) c.options.plugins.gp.bands = bands; });
      const margin = s.Iord.map(I => I - v.margin);
      setData(ch.i, [xy(s.t, s.Iord, 1000), xy(s.t, s.Idr, 1000), xy(s.t, s.Idi, 1000), xy(s.t, margin, 1000)]);
      setData(ch.v, [xy(s.t, s.Vdr, 1000), xy(s.t, s.Vdi, 1000)]);
      setData(ch.a, [xy(s.t, s.alpha, 1000), xy(s.t, s.gamma, 1000), hline(0, T, v.gammaCF), xy(s.t, s.beta, 1000)]);
      setData(ch.p, [xy(s.t, s.Pd, 1000), xy(s.t, s.Pord, 1000), xy(s.t, s.kr, 1000), xy(s.t, s.ki, 1000)]);

      setKpis('pole', [
        { label: 'Final DC power', value: f(k.final.P, 3, ' pu'), sub: `α ${f(k.final.alpha, 1)}° · γ ${f(k.final.gamma, 1)}°`, tone: 'ok' },
        { label: 'Peak I_d', value: f(k.peakId, 3, ' pu'), tone: k.peakId > 1.5 ? 'bad' : k.peakId > 1.2 ? 'warn' : 'sky' },
        { label: 'Min γ (no CF)', value: f(k.minGamma, 1, '°'), tone: k.minGamma !== null && k.minGamma < v.gammaCF + 3 ? 'warn' : 'sky' },
        { label: 'Commutation failures', value: String(k.cfCount), sub: k.cfTime ? `${f(k.cfTime * 1000, 0)} ms in CF` : 'none', tone: k.cfCount ? 'bad' : 'ok' },
        { label: 'VDCOL limiting', value: f(k.vdcolTime * 1000, 0, ' ms'), tone: k.vdcolTime ? 'warn' : 'plain' },
        { label: 'Inverter CC (mode shift)', value: f(k.shiftTime * 1000, 0, ' ms'), tone: k.shiftTime ? 'warn' : 'plain' },
        { label: 'Recovery to 90 % P', value: k.blocked ? 'blocked' : k.recovery === null ? (k.Ppre === null ? 'n/a' : '> sim') : f(k.recovery * 1000, 0, ' ms'), sub: 'after last disturbance', tone: k.blocked ? 'bad' : 'ind' },
        { label: k.overshoot !== null ? 'I_d overshoot' : 'DC-fault restarts', value: k.overshoot !== null ? f(k.overshoot, 1, ' %') : `${k.restarts}${k.blocked ? ' · BLOCKED' : ''}`, tone: k.overshoot > 30 || k.blocked ? 'bad' : 'plain' }
      ]);
      let msg = null, tone = 'info';
      if (k.blocked) { msg = `<b>Pole blocked</b> — the permanent DC fault re-struck after ${k.restarts} restart attempt(s).`; tone = 'bad'; }
      else if (k.cfCount) { msg = `<b>${k.cfCount} commutation failure(s)</b> — γ fell below ${v.gammaCF}°, the inverter bridge short-circuited V<sub>di</sub> and VDCOL reduced the current order. ${v.cfpOn ? 'CFPREV is on.' : 'Try the “… with CFPREV” preset.'}`; tone = 'bad'; }
      else if (k.overshoot !== null && k.overshoot > 40) { msg = `<b>Poorly damped current loop</b> — ${f(k.overshoot, 0)} % overshoot. Check the phase margin in module 2.`; tone = 'warn'; }
      else if (k.shiftTime > 0.02) { msg = `<b>Mode shift</b> — the rectifier ran out of voltage (α at α<sub>min</sub>) and the inverter took over current control at I<sub>ord</sub> − ΔI.`; tone = 'warn'; }
      setBanner('pole-banner', tone, msg);
      scrub.max = s.t.length - 1;
      if (+scrub.value > s.t.length - 1) scrub.value = s.t.length - 1;
      updateCursor();
    }

    const scrub = $('#pole-scrub');
    function updateCursor() {
      if (!res) return;
      const s = res.series, i = Math.min(+scrub.value, s.t.length - 1), tms = s.t[i] * 1000;
      Object.values(ch).forEach(c => { if (c) { c.options.plugins.gp.cursor = tms; c.update('none'); } });
      $('#pole-cursor-t').textContent = `t = ${tms.toFixed(1)} ms`;
      const mode = s.mode[i];
      const pill = $('#pole-mode-pill');
      pill.textContent = M.MODE_LABELS[mode];
      pill.style.background = mode ? MODE_COLORS[mode].replace(/0\.\d+\)/, '0.25)') : 'rgba(16,185,129,0.15)';
      pill.style.color = MODE_SOLID[mode];
      const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
      set('bd-pord', `${s.Pord[i].toFixed(3)} pu`);
      set('bd-vd', `Vd ${s.Vdr[i].toFixed(3)}`);
      set('bd-vdcol', s.vdcol[i] ? 'LIMITING' : 'inactive');
      set('bd-iord', `Iord ${s.Iord[i].toFixed(3)}`);
      set('bd-er', `e ${(s.Iord[i] - s.Idr[i]).toFixed(3)}`);
      set('bd-alpha', `α ${s.alpha[i].toFixed(1)}°`);
      set('bd-vdr', `Vdr ${s.Vdr[i].toFixed(3)}  kr ${s.kr[i].toFixed(2)}`);
      set('bd-id', `Id ${s.Idr[i].toFixed(3)} / ${s.Idi[i].toFixed(3)}`);
      set('bd-ei', `e ${(s.Iord[i] - ctl.get().margin - s.Idi[i]).toFixed(3)}`);
      set('bd-dg', `Δγ ${s.dg[i].toFixed(1)}°`);
      set('bd-beta', `β ${s.beta[i].toFixed(1)}°`);
      set('bd-vdi', `Vdi ${s.Vdi[i].toFixed(3)}  ki ${s.ki[i].toFixed(2)}`);
      set('bd-gamma', mode === 2 ? 'γ — COMMUTATION FAILURE' : `γ ${s.gamma[i].toFixed(1)}°`);
      const hl = (id, color) => { const el = document.getElementById(id); if (el) { el.style.stroke = color || ''; el.style.strokeWidth = color ? '2.5' : ''; } };
      hl('bx-pirect', mode === 0 ? C.emerald : mode === 3 ? C.violet : null);
      hl('bx-piinv', mode === 1 ? C.amber : null);
      hl('bx-vdcol', s.vdcol[i] ? C.amber : null);
      hl('bx-inv', mode === 2 ? C.rose : null);
      hl('bx-rect', mode === 3 || mode === 4 ? C.violet : null);
    }
    scrub.addEventListener('input', updateCursor);
    let playing = null;
    $('#pole-play').addEventListener('click', () => {
      const lbl = $('#pole-play span');
      if (playing) { cancelAnimationFrame(playing); playing = null; lbl.textContent = 'Play'; return; }
      lbl.textContent = 'Pause';
      if (+scrub.value >= +scrub.max) scrub.value = 0;
      let last = performance.now();
      const step = now => {
        const dtw = now - last; last = now;
        scrub.value = Math.min(+scrub.max, +scrub.value + Math.max(1, Math.round(+scrub.max * dtw / 6000)));
        updateCursor();
        if (+scrub.value >= +scrub.max) { playing = null; lbl.textContent = 'Play'; return; }
        playing = requestAnimationFrame(step);
      };
      playing = requestAnimationFrame(step);
    });

    const ctl = buildControls('pole', '[data-controls="pole"]', schema, run);
    buildPresets('[data-presets="pole"]', presets, p => ctl.set({ ...ctl.defaults, ...p.v }));
    buildToolbar('pole', { csv: () => res && download('hvdc_pole_control.csv', csvOf({ t: 't_s', Pord: 'P_ord_pu', Iord: 'I_ord_pu', Idr: 'Id_rect_pu', Idi: 'Id_inv_pu', Vdr: 'Vd_rect_pu', Vdi: 'Vd_inv_pu', alpha: 'alpha_deg', beta: 'beta_deg', gamma: 'gamma_deg', Pd: 'Pd_pu', kr: 'k_rect', ki: 'k_inv', mode: 'mode', vdcol: 'vdcol_active' }, res.series)) });
    MODULES.pole = { ctl, run, getParams: () => toParams(ctl.get()) };
    run();
  }

  function poleDiagramSvg() {
    const box = (id, x, y, w, title, valId, sub) => `
      <g><rect id="${id}" x="${x}" y="${y}" width="${w}" height="46" rx="10" class="fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700" stroke-width="1.2"/>
      <text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" class="fill-slate-700 dark:fill-slate-200" font-size="11" font-weight="700">${title}</text>
      <text id="${valId}" x="${x + w / 2}" y="${y + 35}" text-anchor="middle" class="fill-sky-600 dark:fill-sky-400" font-size="10.5">${sub || '—'}</text></g>`;
    const sum = (x, y, valId) => `<g><circle cx="${x}" cy="${y}" r="13" class="fill-white dark:fill-slate-900 stroke-slate-400 dark:stroke-slate-600" stroke-width="1.2"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="13" class="fill-slate-600 dark:fill-slate-300">Σ</text><text id="${valId}" x="${x}" y="${y - 19}" text-anchor="middle" font-size="9.5" class="fill-slate-500">—</text></g>`;
    const line = (pts, dash) => `<polyline points="${pts}" fill="none" class="stroke-slate-400 dark:stroke-slate-500" stroke-width="1.3" ${dash ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#arw)"/>`;
    const lbl = (x, y, id, txt, anchor = 'middle') => `<text id="${id}" x="${x}" y="${y}" text-anchor="${anchor}" font-size="10" class="fill-emerald-600 dark:fill-emerald-400" font-weight="600">${txt}</text>`;
    return `<svg viewBox="0 0 960 262" class="sim-svg w-full min-w-[760px] h-auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="LCC-HVDC pole control block diagram">
      <defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fill-slate-400 dark:fill-slate-500"/></marker></defs>
      <text x="10" y="14" font-size="10" font-weight="700" class="fill-slate-400">RECTIFIER (current control)</text>
      <text x="10" y="252" font-size="10" font-weight="700" class="fill-slate-400">INVERTER (CEA + current control with margin)</text>
      ${box('bx-pord', 10, 26, 105, 'Power order', 'bd-pord')}
      ${line('115,49 138,49')}
      ${box('bx-div', 140, 26, 95, 'P ÷ V<tspan baseline-shift="sub" font-size="8">d</tspan>', 'bd-vd')}
      ${line('235,49 258,49')}
      ${box('bx-vdcol', 260, 26, 110, 'VDCOL · limits', 'bd-vdcol')}
      ${line('370,49 412,49')}
      ${lbl(400, 20, 'bd-iord', 'Iord')}
      ${sum(428, 49, 'bd-er')}
      ${line('441,49 463,49')}
      ${box('bx-pirect', 465, 26, 110, 'PI  rect CC', 'bd-alpha')}
      ${line('575,49 718,49')}
      <text x="646" y="42" text-anchor="middle" font-size="9.5" class="fill-slate-500">firing (T<tspan baseline-shift="sub" font-size="7">d</tspan>)</text>
      ${box('bx-rect', 720, 26, 230, 'Rectifier  V<tspan baseline-shift="sub" font-size="8">do</tspan>cosα − R<tspan baseline-shift="sub" font-size="8">c</tspan>I<tspan baseline-shift="sub" font-size="8">d</tspan>', 'bd-vdr')}
      ${line('835,72 835,106')}
      ${box('bx-dc', 720, 108, 230, 'DC circuit  L·dI/dt = V<tspan baseline-shift="sub" font-size="8">dr</tspan> − V<tspan baseline-shift="sub" font-size="8">di</tspan> − R<tspan baseline-shift="sub" font-size="8">d</tspan>I', 'bd-id')}
      ${line('835,190 835,156')}
      ${line('720,131 390,131 390,62 417,57', true)}
      <text x="560" y="125" text-anchor="middle" font-size="9.5" class="fill-slate-500">measured I<tspan baseline-shift="sub" font-size="7">d</tspan> (T<tspan baseline-shift="sub" font-size="7">m</tspan>)</text>
      ${line('390,131 390,200 417,207', true)}
      ${line('380,49 380,213 415,213')}
      <text x="372" y="160" text-anchor="end" font-size="9.5" class="fill-amber-500" font-weight="600">−ΔI</text>
      ${sum(428, 213, 'bd-ei')}
      ${line('441,213 463,213')}
      ${box('bx-piinv', 465, 190, 110, 'PI  inv CC', 'bd-dg')}
      ${line('575,213 588,213')}
      ${box('bx-cea', 590, 190, 112, 'CEA predictor', 'bd-beta')}
      ${line('702,213 718,213')}
      ${box('bx-inv', 720, 190, 230, 'Inverter  V<tspan baseline-shift="sub" font-size="8">do</tspan>cosβ + R<tspan baseline-shift="sub" font-size="8">c</tspan>I<tspan baseline-shift="sub" font-size="8">d</tspan>', 'bd-vdi')}
      <text id="bd-gamma" x="835" y="252" text-anchor="middle" font-size="10.5" font-weight="700" class="fill-amber-600 dark:fill-amber-400">γ</text>
    </svg>`;
  }

  /* ================================================================
     MODULE 2 — TUNING
  ================================================================ */
  function initTune() {
    const schema = [
      { title: 'PI controller', open: true, items: [
        { id: 'Kp', label: 'K<sub>p</sub>', min: 0.2, max: 60, step: 0.1, value: 6.8, unit: 'rad/pu' },
        { id: 'Ti', label: 'T<sub>i</sub>', min: 1, max: 200, step: 0.5, value: 28, unit: 'ms' }
      ] },
      { title: 'Plant & operating point', open: true, items: [
        { id: 'alpha0', label: 'Operating α<sub>0</sub>', min: 5, max: 40, step: 0.5, value: 15, unit: '°' },
        { id: 'L', label: 'DC inductance L', min: 2, max: 50, step: 0.5, value: 10, unit: 'ms' },
        { id: 'Rd', label: 'DC resistance R<sub>d</sub>', min: 0.005, max: 0.1, step: 0.005, value: 0.03, unit: 'pu' },
        { id: 'dx', label: 'd<sub>x</sub>', min: 0.04, max: 0.12, step: 0.005, value: 0.08, unit: 'pu' },
        { id: 'Td', label: 'Dead time T<sub>d</sub>', min: 0, max: 3.4, step: 0.01, value: 0.83, unit: 'ms', fmt: v => `${v.toFixed(2)} ms` },
        { id: 'Tm', label: 'Measurement filter T<sub>m</sub>', min: 0.05, max: 5, step: 0.05, value: 1, unit: 'ms' },
        { id: 'invMode', type: 'select', label: 'Inverter control during the test', value: 'CEA', options: [['CEA', 'CEA (γ constant) → R_eq = R_d'], ['beta', 'Constant β → R_eq = R_d + 2R_c']] },
        { id: 'pulse', type: 'select', label: 'Dead-time preset', value: 'custom', options: [['custom', 'custom'], ['12-50', '12-pulse, 50 Hz (0.83 ms)'], ['12-60', '12-pulse, 60 Hz (0.69 ms)'], ['6-50', '6-pulse, 50 Hz (1.67 ms)'], ['6-60', '6-pulse, 60 Hz (1.39 ms)']] }
      ] }
    ];
    const auto = [
      { id: 'fc', label: 'Target bandwidth f<sub>c</sub>', min: 3, max: 120, step: 1, value: 32, unit: 'Hz' },
      { id: 'pm', label: 'Target phase margin', min: 30, max: 75, step: 1, value: 60, unit: '°' }
    ];
    const ch = {
      mag: makeChart('ch-tune-mag', { xLog: true, xTitle: 'ω [rad/s]', xLabel: 'ω', yTitle: 'magnitude [dB]', datasets: [
        { label: 'Loop C·G', color: C.sky }, { label: 'Plant G', color: C.slate, dash: [5, 4], width: 1.3 },
        { label: '_0dB', color: C.slate, width: 1 }, { label: 'ω_c', color: C.rose, point: 5, showLine: false }
      ] }),
      ph: makeChart('ch-tune-ph', { xLog: true, xTitle: 'ω [rad/s]', xLabel: 'ω', yTitle: 'phase [°]', datasets: [
        { label: 'Loop C·G', color: C.amber }, { label: 'Plant G', color: C.slate, dash: [5, 4], width: 1.3 },
        { label: '_-180', color: C.rose, width: 1, dash: [4, 3] }, { label: 'PM at ω_c', color: C.rose, point: 5, showLine: true, width: 2 }
      ] }),
      step: makeChart('ch-tune-step', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'I_d / I_ref', datasets: [
        { label: 'I_d', color: C.emerald }, { label: 'reference', color: C.slate, dash: [5, 4], width: 1.2 },
        { label: '±2 %', color: C.slate, dash: [2, 3], width: 0.8 }, { label: '_lo', color: C.slate, dash: [2, 3], width: 0.8 }
      ] })
    };
    function params() {
      const v = ctl.get();
      return { Kp: v.Kp, Ti: v.Ti / 1000, alpha0: v.alpha0, L: v.L / 1000, Rd: v.Rd, dx: v.dx, Td: v.Td / 1000, Tm: v.Tm / 1000, invMode: v.invMode, gammaRef: 18 };
    }
    let lastPulse = 'custom';
    function run() {
      const v = ctl.get();
      if (v.pulse !== 'custom' && v.pulse !== lastPulse) {
        const [pp, fr] = v.pulse.split('-').map(Number);
        lastPulse = v.pulse; ctl.set({ Td: +(1000 / (2 * pp * fr)).toFixed(2) }, true);
      } else if (v.pulse === 'custom') lastPulse = 'custom';
      const b = M.bodeCC(params());
      const w0 = b.w[0], w1 = b.w[b.w.length - 1];
      const phMin = Math.max(-400, Math.min(...b.phDeg));
      setData(ch.mag, [xy(b.w, b.magDb), xy(b.w, b.plantDb), hline(w0, w1, 0), b.wc ? [{ x: b.wc, y: 0 }] : []]);
      setData(ch.ph, [xy(b.w, b.phDeg.map(p => Math.max(p, phMin))), xy(b.w, b.plantPh.map(p => Math.max(p, phMin))), hline(w0, w1, -180), b.wc ? [{ x: b.wc, y: -180 }, { x: b.wc, y: b.pm - 180 }] : []]);
      const st = b.step, T = st.t.length ? st.t[st.t.length - 1] * 1000 : 100;
      setData(ch.step, [xy(st.t, st.y.map(y => Math.max(-1, Math.min(3, y))), 1000), hline(0, T, 1), hline(0, T, 1.02), hline(0, T, 0.98)]);
      const pmTone = b.pm === null ? 'plain' : b.pm < 30 ? 'bad' : b.pm < 45 ? 'warn' : 'ok';
      setKpis('tune', [
        { label: 'Crossover ω_c', value: b.wc ? `${f(b.wc, 0)} rad/s` : '—', sub: b.wc ? `${f(b.wc / 2 / Math.PI, 1)} Hz` : '', tone: 'sky' },
        { label: 'Phase margin', value: f(b.pm, 1, '°'), tone: pmTone },
        { label: 'Gain margin', value: f(b.gm, 1, ' dB'), sub: b.w180 ? `at ${f(b.w180, 0)} rad/s` : '', tone: b.gm !== null && b.gm < 6 ? 'bad' : 'ok' },
        { label: 'Closed loop', value: b.stable ? 'stable' : 'UNSTABLE', tone: b.stable ? 'ok' : 'bad' },
        { label: 'Overshoot', value: f(st.overshoot, 1, ' %'), tone: st.overshoot > 30 ? 'warn' : 'plain' },
        { label: 'Rise time 10–90 %', value: st.rise ? f(st.rise * 1000, 2, ' ms') : '—', tone: 'plain' },
        { label: 'Settling (2 %)', value: st.settle ? f(st.settle * 1000, 1, ' ms') : '—', tone: 'plain' },
        { label: 'Plant gain', value: f(b.plant.Ka, 3), sub: `V_do·sinα₀ · R_eq ${f(b.plant.R, 3)}`, tone: 'ind' }
      ]);
    }
    const actl = buildControls('tune-auto', '[data-controls="tune-auto"]', auto, () => {});
    const ctl = buildControls('tune', '[data-controls="tune"]', schema, run);
    $('#tune-auto-btn').addEventListener('click', () => {
      const a = actl.get();
      const r = M.autoTuneCC(params(), 2 * Math.PI * a.fc, a.pm);
      const note = $('#tune-note');
      if (r.note) { note.textContent = r.note; note.classList.remove('hidden'); } else note.classList.add('hidden');
      ctl.set({ Kp: Math.min(60, Math.max(0.2, +r.Kp.toFixed(1))), Ti: Math.min(200, Math.max(1, +(r.Ti * 1000).toFixed(1))) });
      toast(`Auto-tuned: Kp ${r.Kp.toFixed(2)} rad/pu, Ti ${(r.Ti * 1000).toFixed(1)} ms`);
    });
    $('#tune-send-btn').addEventListener('click', () => {
      const v = ctl.get();
      showModule('pole');
      history.replaceState(null, '', '#m=pole');
      const pole = MODULES.pole;
      pole.ctl.set({ ...pole.ctl.get(), Kp: v.Kp, Ti: Math.round(v.Ti), L: v.L, Rd: v.Rd, dx: v.dx, Td: v.Td, rampOn: true, P1: 0.9, rate: 100, rdOn: false, idOn: false, dfOn: false, T: 0.5 });
      toast('Gains applied to Pole Control (0.1 pu order step)');
    });
    buildToolbar('tune', { csv: () => { const b = M.bodeCC(params()); download('cc_loop_bode.csv', csvOf({ w: 'w_rad_s', magDb: 'loop_mag_dB', phDeg: 'loop_phase_deg', plantDb: 'plant_mag_dB', plantPh: 'plant_phase_deg' }, b)); } });
    MODULES.tune = { ctl, run };
    run();
  }

  /* ================================================================
     MODULE 3 — COMMUTATION MARGIN
  ================================================================ */
  function initCF() {
    const schema = [
      { title: 'Pre-disturbance operating point', open: true, items: [
        { id: 'gamma0', label: 'CEA order γ<sub>0</sub>', min: 12, max: 30, step: 0.5, value: 18, unit: '°' },
        { id: 'dx', label: 'd<sub>x</sub> (relative inductive drop)', min: 0.04, max: 0.12, step: 0.005, value: 0.08, unit: 'pu' },
        { id: 'Id0', label: 'DC current I<sub>d0</sub>', min: 0.2, max: 1.2, step: 0.05, value: 1.0, unit: 'pu' }
      ] },
      { title: 'Disturbance', open: true, items: [
        { id: 'dip', label: 'Commutation-voltage dip ΔU', min: 0, max: 0.5, step: 0.01, value: 0.15, fmt: v => `${(v * 100).toFixed(0)} %` },
        { id: 'phi', label: 'Zero-crossing shift φ', min: -10, max: 5, step: 0.5, value: 0, unit: '°' },
        { id: 'surge', label: 'Current surge I<sub>d</sub>′/I<sub>d0</sub>', min: 1, max: 1.6, step: 0.05, value: 1, unit: '×' }
      ] },
      { title: 'Valve', open: true, items: [
        { id: 'tq', label: 'Turn-off (deionisation) time t<sub>q</sub>', min: 100, max: 800, step: 10, value: 400, unit: 'µs' },
        { id: 'f', type: 'select', label: 'System frequency', value: '50', options: [['50', '50 Hz'], ['60', '60 Hz']] }
      ] }
    ];
    const ch = {
      g: makeChart('ch-cf-g', { xTitle: 'voltage dip ΔU [%]', xLabel: 'ΔU %', yTitle: 'γ [°]', yMin: 0, datasets: [
        { label: 'φ=0, I_d const', color: C.sky }, { label: 'selected φ & surge', color: C.amber },
        { label: 'γ_min', color: C.rose, dash: [5, 4], width: 1.3 }, { label: 'operating point', color: C.pink, point: 6, showLine: false }
      ] }),
      map: makeChart('ch-cf-map', { xTitle: 'phase shift φ [°]', xLabel: 'φ', yTitle: 'critical dip [%]', yMin: 0, datasets: [
        { label: 'γ₀ = 15°', color: C.rose }, { label: 'γ₀ = 18°', color: C.amber }, { label: 'γ₀ = 22°', color: C.emerald },
        { label: 'your γ₀', color: C.sky, width: 3 }, { label: 'operating point', color: C.pink, point: 6, showLine: false }
      ] }),
      wave: makeChart('ch-cf-wave', { xTitle: 'electrical angle ωt [°]', xLabel: 'ωt', yTitle: 'commutation voltage [pu]', xMin: 90, xMax: 200, datasets: [
        { label: 'pre-fault', color: C.slate, width: 1.5, dash: [5, 4] }, { label: 'post-fault', color: C.sky },
        { label: 'overlap μ', color: C.amber, fill: 'origin', bg: 'rgba(245,158,11,0.30)', width: 0 },
        { label: 'margin γ', color: C.emerald, fill: 'origin', bg: 'rgba(16,185,129,0.30)', width: 0 },
        { label: 'γ_min zone', color: C.rose, fill: 'origin', bg: 'rgba(244,63,94,0.25)', width: 0 },
        { label: 'firing', color: C.violet, width: 1.5 }
      ] })
    };
    function run() {
      const v = ctl.get();
      const r = M.cfModel({ gamma0: v.gamma0, dx: v.dx, Id0: v.Id0, surge: v.surge, dip: v.dip, phi: v.phi, tq: v.tq * 1e-6, f: +v.f });
      const dips = []; for (let d = 0; d <= 0.5001; d += 0.005) dips.push(d);
      setData(ch.g, [
        dips.map(d => ({ x: d * 100, y: r.gammaAfter(d, 0, 1) })),
        dips.map(d => ({ x: d * 100, y: r.gammaAfter(d, v.phi, v.surge) })),
        hline(0, 50, r.gammaCF), [{ x: v.dip * 100, y: r.gamma }]
      ]);
      const phis = []; for (let p = -10; p <= 5.001; p += 0.25) phis.push(p);
      const curve = g0 => phis.map(p => ({ x: p, y: 100 * r.critDip(p, v.surge, g0) }));
      setData(ch.map, [curve(15), curve(18), curve(22), curve(v.gamma0), [{ x: v.phi, y: v.dip * 100 }]]);
      // waveform
      const k = 1 - v.dip, zc = 180 + v.phi, fire = 180 - r.beta0;
      const gPost = r.gamma, muPost = Math.max(0, (r.beta0 + v.phi) - gPost);
      const sinv = (th, kk, sh) => kk * Math.sin((th - sh) * Math.PI / 180);
      const pre = [], post = []; for (let th = 90; th <= 200; th += 0.5) { pre.push({ x: th, y: sinv(th, 1, 0) }); post.push({ x: th, y: sinv(th, k, v.phi) }); }
      const seg = (a, b) => { const o = []; if (b <= a) return o; for (let th = a; th <= b + 1e-9; th += Math.max(0.1, (b - a) / 60)) o.push({ x: th, y: sinv(th, k, v.phi) }); return o; };
      const endOv = r.cf ? zc : fire + muPost;
      setData(ch.wave, [pre, post, seg(fire, Math.min(endOv, zc)), r.cf ? [] : seg(endOv, zc), seg(zc - r.gammaCF, zc), [{ x: fire, y: -1.1 }, { x: fire, y: 1.1 }]]);
      setKpis('cf', [
        { label: 'Advance angle β₀', value: f(r.beta0, 1, '°'), sub: `overlap μ₀ ${f(r.mu0, 1)}°`, tone: 'sky' },
        { label: 'γ_min = ω·t_q', value: f(r.gammaCF, 1, '°'), tone: 'plain' },
        { label: 'γ after disturbance', value: r.cf ? 'FAILS' : f(r.gamma, 1, '°'), tone: r.cf ? 'bad' : r.margin < 3 ? 'warn' : 'ok' },
        { label: 'Margin to CF', value: r.cf ? '—' : f(r.margin, 1, '°'), tone: r.cf ? 'bad' : 'ind' },
        { label: 'Critical dip (this φ)', value: f(r.critDipNow * 100, 1, ' %'), tone: r.critDipNow < 0.1 ? 'bad' : 'sky' },
        { label: 'Critical dip (φ=0)', value: f(r.critDip(0, 1) * 100, 1, ' %'), tone: 'plain' },
        { label: 'Status', value: r.cf ? 'COMMUTATION FAILURE' : 'commutates', tone: r.cf ? 'bad' : 'ok' },
        { label: 'Δγ / Δφ sensitivity', value: f(Math.sin(r.beta0 * Math.PI / 180) / Math.max(0.05, Math.sin(v.gamma0 * Math.PI / 180)), 2, ' °/°'), tone: 'plain' }
      ]);
    }
    const ctl = buildControls('cf', '[data-controls="cf"]', schema, run);
    buildToolbar('cf', { csv: () => { const r = M.cfModel({ ...ctl.get(), tq: ctl.get().tq * 1e-6, f: +ctl.get().f }); const rows = { d: [], g0: [], gs: [] }; for (let d = 0; d <= 0.5001; d += 0.01) { rows.d.push(d); rows.g0.push(r.gammaAfter(d, 0, 1)); rows.gs.push(r.gammaAfter(d, ctl.get().phi, ctl.get().surge)); } download('commutation_margin.csv', csvOf({ d: 'dip_pu', g0: 'gamma_sym_deg', gs: 'gamma_selected_deg' }, rows)); } });
    MODULES.cf = { ctl, run };
    run();
  }

  /* ================================================================
     MODULE 4 — RPC
  ================================================================ */
  function initRPC() {
    const schema = [
      { title: 'Control mode', open: true, items: [
        { id: 'mode', type: 'select', label: 'RPC mode', value: 'Q', options: [['Q', 'Q control (exchange inside band)'], ['U', 'U control (voltage limits only)']] },
        { id: 'band', label: 'Q dead-band ±B', min: 0.02, max: 0.3, step: 0.01, value: 0.08, unit: 'pu' },
        { id: 'bias', label: 'Operator Q bias (Q<sub>ref</sub>)', min: -0.3, max: 0.3, step: 0.01, value: 0, unit: 'pu' },
        { id: 'Umin', label: 'U<sub>min</sub>', min: 0.9, max: 1, step: 0.005, value: 0.95, unit: 'pu' },
        { id: 'Umax', label: 'U<sub>max</sub>', min: 1, max: 1.1, step: 0.005, value: 1.05, unit: 'pu' },
        { id: 'tsw', label: 'Switching delay', min: 0.2, max: 5, step: 0.1, value: 1, unit: 's' }
      ] },
      { title: 'Filter banks', open: true, items: [
        { id: 'nBanks', label: 'Number of banks', min: 2, max: 10, step: 1, value: 6 },
        { id: 'Qb', label: 'Bank size Q<sub>b</sub>', min: 0.04, max: 0.3, step: 0.01, value: 0.12, unit: 'pu' },
        { id: 'mf2', label: 'Min-filter: 2nd bank above P', min: 0, max: 1, step: 0.05, value: 0.5, fmt: v => v <= 0 ? 'never' : `${v.toFixed(2)} pu` },
        { id: 'mf3', label: 'Min-filter: 3rd bank above P', min: 0, max: 1, step: 0.05, value: 0, fmt: v => v <= 0 ? 'never' : `${v.toFixed(2)} pu` }
      ] },
      { title: 'Converter & AC system', items: [
        { id: 'angle', label: 'Control angle (α rect / γ inv)', min: 8, max: 30, step: 0.5, value: 15, unit: '°' },
        { id: 'dx', label: 'd<sub>x</sub>', min: 0.04, max: 0.12, step: 0.005, value: 0.08, unit: 'pu' },
        { id: 'SCR', label: 'Short-circuit ratio SCR', min: 1.5, max: 10, step: 0.1, value: 5 },
        { id: 'Pmin', label: 'Minimum power', min: 0.05, max: 0.5, step: 0.05, value: 0.1, unit: 'pu' },
        { id: 'rate', label: 'Power ramp rate', min: 0.005, max: 0.2, step: 0.005, value: 0.05, unit: 'pu/s' }
      ] }
    ];
    const presets = [
      { name: 'Balanced', sub: 'SCR 5, ±0.08 band', v: {} },
      { name: 'Weak AC system', sub: 'SCR 2.5 → U limits act', v: { SCR: 2.5 } },
      { name: 'Narrow band', sub: '±0.04 < Q_b/2 → hunting', v: { band: 0.04, rate: 0.01 } },
      { name: 'Operator bias', sub: 'Q_ref = +0.10 (export)', v: { bias: 0.1 } },
      { name: 'U control', sub: 'voltage limits only', v: { mode: 'U', SCR: 3 } },
      { name: 'Big banks', sub: '4 × 0.22 pu', v: { nBanks: 4, Qb: 0.22, band: 0.12 } }
    ];
    const ch = {
      q: makeChart('ch-rpc-q', { xTitle: 'time [s]', xLabel: 't [s]', yTitle: 'reactive power [pu]', y2Title: 'P [pu]', y2Min: 0, y2Max: 1.2, datasets: [
        { label: 'Q converter (absorbed)', color: C.amber }, { label: 'Q filters', color: C.emerald, stepped: true },
        { label: 'Q exchange', color: C.sky, width: 2.5 }, { label: 'band', color: C.rose, dash: [5, 4], width: 1 },
        { label: '_bandlo', color: C.rose, dash: [5, 4], width: 1 }, { label: 'P', color: C.slate, dash: [2, 3], width: 1.2, axis: 'y2' }
      ] }),
      v: makeChart('ch-rpc-v', { xTitle: 'time [s]', xLabel: 't [s]', yTitle: 'U_ac [pu]', y2Title: 'banks in service', y2Min: 0, datasets: [
        { label: 'U_ac', color: C.sky }, { label: 'U limits', color: C.rose, dash: [5, 4], width: 1 }, { label: '_umin', color: C.rose, dash: [5, 4], width: 1 },
        { label: 'banks', color: C.emerald, stepped: true, axis: 'y2', fill: 'origin', bg: 'rgba(16,185,129,0.12)', width: 1.5 }
      ] }),
      loop: makeChart('ch-rpc-loop', { xTitle: 'P [pu]', xLabel: 'P', yTitle: 'Q exchange [pu]', datasets: [
        { label: 'ramp up', color: C.sky, width: 2 }, { label: 'ramp down', color: C.orange, width: 2 },
        { label: 'band', color: C.rose, dash: [5, 4], width: 1 }, { label: '_lo', color: C.rose, dash: [5, 4], width: 1 },
        { label: '−Q conv(P)', color: C.slate, dash: [2, 3], width: 1.2 }
      ] })
    };
    let res = null;
    function params() {
      const v = ctl.get();
      const mf = [0.02]; if (v.mf2 > 0) mf.push(v.mf2); if (v.mf3 > 0) mf.push(Math.max(v.mf3, v.mf2 + 0.01));
      return { nBanks: v.nBanks, Qb: v.Qb, minFilter: mf, angle: v.angle, dx: v.dx, SCR: v.SCR, band: v.band, bias: v.bias, mode: v.mode, Umin: v.Umin, Umax: v.Umax, Pmin: v.Pmin, rate: v.rate, tsw: v.tsw };
    }
    function run() {
      const v = ctl.get();
      res = M.rpcSim(params());
      const s = res.series, k = res.kpi, T = s.t[s.t.length - 1];
      setData(ch.q, [xy(s.t, s.Qconv), xy(s.t, s.Qfilt), xy(s.t, s.Qexch), hline(0, T, v.bias + v.band), hline(0, T, v.bias - v.band), xy(s.t, s.P)]);
      ch.v.options.scales.y2.max = v.nBanks + 1;
      setData(ch.v, [xy(s.t, s.Vac), hline(0, T, v.Umax), hline(0, T, v.Umin), xy(s.t, s.n)]);
      const iTop = s.P.indexOf(Math.max(...s.P));
      const up = [], dn = [];
      for (let i = 0; i < s.t.length; i++) (i <= iTop ? up : dn).push({ x: s.P[i], y: s.Qexch[i] });
      setData(ch.loop, [up, dn, hline(0, 1.05, v.bias + v.band), hline(0, 1.05, v.bias - v.band), res.curve.map(c => ({ x: c.P, y: -c.Q }))]);
      setKpis('rpc', [
        { label: 'Switching operations', value: String(k.ops), tone: k.ops > 3 * v.nBanks ? 'bad' : 'sky' },
        { label: 'Max |Q_ex − Q_ref|', value: f(k.maxDev, 3, ' pu'), tone: k.maxDev > v.band * 1.6 ? 'warn' : 'ok' },
        { label: 'U range', value: `${f(k.vMin, 3)}–${f(k.vMax, 3)}`, tone: k.vMax > v.Umax + 0.005 || k.vMin < v.Umin - 0.005 ? 'warn' : 'ok' },
        { label: 'ΔU per bank', value: f(k.dVstep, 2, ' %'), sub: 'Q_b / SCR', tone: k.dVstep > 3 ? 'warn' : 'plain' },
        { label: 'Converter Q at 1 pu', value: f(k.qAtRated, 3, ' pu'), sub: `Q/P ${f(k.qAtRated, 2)}`, tone: 'ind' },
        { label: 'Installed filter Q', value: f(k.totalFilters, 2, ' pu'), tone: 'plain' },
        { label: 'Band vs bank', value: `2B ${f(2 * v.band, 2)} / Q_b ${f(v.Qb, 2)}`, tone: k.hunting ? 'bad' : 'ok' },
        { label: 'Hunting risk', value: k.hunting ? 'YES' : 'no', tone: k.hunting ? 'bad' : 'ok' }
      ]);
      setBanner('rpc-banner', k.hunting ? 'bad' : null, k.hunting ? `<b>Dead-band narrower than one bank</b> (2B = ${f(2 * v.band, 2)} pu < Q<sub>b</sub> = ${f(v.Qb, 2)} pu): switching a bank in pushes Q<sub>ex</sub> past the opposite limit, so the RPC can hunt whenever P is steady. ${k.ops} operations in this run.` : null);
      $('#rpc-events').innerHTML = s.events.length ? `<table class="w-full text-left font-mono"><thead class="text-slate-500"><tr><th class="py-1 pr-3">t [s]</th><th class="pr-3">P [pu]</th><th class="pr-3">operation</th><th class="pr-3">banks</th><th>reason</th></tr></thead><tbody>${s.events.slice(0, 80).map(e => `<tr class="border-t border-slate-100 dark:border-slate-800"><td class="py-1 pr-3">${e.t.toFixed(1)}</td><td class="pr-3">${e.P.toFixed(2)}</td><td class="pr-3 ${e.dir === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">${e.dir === 'in' ? '▲ switch IN' : '▼ switch OUT'}</td><td class="pr-3">${e.n}</td><td>${e.reason}</td></tr>`).join('')}</tbody></table>${s.events.length > 80 ? `<p class="mt-1 text-slate-500">… ${s.events.length - 80} more</p>` : ''}` : '<p class="text-slate-500">No switching operations.</p>';
    }
    const ctl = buildControls('rpc', '[data-controls="rpc"]', schema, run);
    buildPresets('[data-presets="rpc"]', presets, p => ctl.set({ ...ctl.defaults, ...p.v }));
    buildToolbar('rpc', { csv: () => res && download('rpc_filter_switching.csv', csvOf({ t: 't_s', P: 'P_pu', Qconv: 'Q_conv_pu', Qfilt: 'Q_filters_pu', Qexch: 'Q_exchange_pu', Vac: 'U_ac_pu', n: 'banks' }, res.series)) });
    MODULES.rpc = { ctl, run };
    run();
  }

  /* ================================================================
     MODULE 5 — VSC
  ================================================================ */
  function initVSC() {
    const schema = [
      { title: 'Operating mode', open: true, items: [
        { id: 'mode', type: 'select', label: 'Station control', value: 'current', options: [['current', 'Inner current loop test (id*, iq* steps)'], ['vdc', 'DC-voltage control (remote power step)']] },
        { id: 'T', label: 'Simulated time', min: 0.1, max: 0.4, step: 0.02, value: 0.2, unit: 's' }
      ] },
      { title: 'Inner current loop', open: true, items: [
        { id: 'BWi', label: 'Bandwidth α<sub>c</sub>/2π', min: 50, max: 1000, step: 10, value: 250, unit: 'Hz' },
        { id: 'fsw', label: 'Effective switching / sampling', min: 0.5, max: 10, step: 0.1, value: 5, unit: 'kHz' },
        { id: 'X', label: 'Phase reactor + transformer X', min: 0.05, max: 0.3, step: 0.01, value: 0.15, unit: 'pu' },
        { id: 'R', label: 'Resistance R', min: 0.001, max: 0.02, step: 0.001, value: 0.005, unit: 'pu' },
        { id: 'decouple', type: 'check', label: 'dq decoupling (±X·i)', value: true },
        { id: 'ffV', type: 'check', label: 'Grid-voltage feed-forward', value: true },
        { id: 'idVal', label: 'i<sub>d</sub>* step (current mode)', min: -1, max: 1, step: 0.05, value: 0.8, unit: 'pu' },
        { id: 'iqVal', label: 'i<sub>q</sub>* step', min: -0.8, max: 0.8, step: 0.05, value: 0.4, unit: 'pu' }
      ] },
      { title: 'DC-voltage loop', items: [
        { id: 'H', label: 'DC energy constant H', min: 5, max: 60, step: 1, value: 20, unit: 'ms' },
        { id: 'BWv', label: 'Bandwidth ω<sub>v</sub>/2π', min: 2, max: 50, step: 1, value: 15, unit: 'Hz' },
        { id: 'zeta', label: 'Damping ζ', min: 0.3, max: 1.5, step: 0.05, value: 0.8 },
        { id: 'ffP', type: 'check', label: 'DC-power feed-forward', value: false },
        { id: 'pdcVal', label: 'Remote power step P<sub>dc</sub>', min: -1, max: 1, step: 0.05, value: 0.8, unit: 'pu' }
      ] },
      { title: 'AC grid event', items: [
        { id: 'dipOn', type: 'check', label: 'Grid voltage dip', value: false },
        { id: 'dipT', label: 'Start', min: 10, max: 300, step: 5, value: 120, unit: 'ms' },
        { id: 'dipDepth', label: 'Depth', min: 0.05, max: 0.9, step: 0.05, value: 0.3, fmt: v => `${(v * 100).toFixed(0)} %` },
        { id: 'dipDur', label: 'Duration', min: 10, max: 150, step: 5, value: 50, unit: 'ms' }
      ] }
    ];
    const presets = [
      { name: 'Inner loop step', sub: 'IMC, 250 Hz', v: {} },
      { name: 'No decoupling', sub: 'see i_q kick', v: { decouple: false } },
      { name: 'Bandwidth too high', sub: '800 Hz on 1 kHz switching', v: { BWi: 800, fsw: 1 } },
      { name: 'DC-voltage control', sub: '0.8 pu power step', v: { mode: 'vdc' } },
      { name: 'V_dc + feed-forward', sub: 'P_dc measured', v: { mode: 'vdc', ffP: true } },
      { name: 'AC fault ride-through', sub: '50 % dip, V_dc mode', v: { mode: 'vdc', dipOn: true, dipDepth: 0.5, dipT: 120 } }
    ];
    const ch = {
      i: makeChart('ch-vsc-i', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'current [pu]', datasets: [
        { label: 'i_d', color: C.sky }, { label: 'i_d*', color: C.sky, dash: [5, 4], width: 1.2 },
        { label: 'i_q', color: C.amber }, { label: 'i_q*', color: C.amber, dash: [5, 4], width: 1.2 }
      ] }),
      vdc: makeChart('ch-vsc-vdc', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'V_dc [pu]', y2Title: 'power [pu]', datasets: [
        { label: 'V_dc', color: C.emerald, width: 2.5 }, { label: '±5 %', color: C.rose, dash: [4, 3], width: 1 }, { label: '_lo', color: C.rose, dash: [4, 3], width: 1 },
        { label: 'P_ac', color: C.indigo, axis: 'y2', width: 1.2 }, { label: 'P_dc in', color: C.slate, axis: 'y2', dash: [2, 3], width: 1.2 }
      ] }),
      vc: makeChart('ch-vsc-vc', { xTitle: 'time [ms]', xLabel: 't [ms]', yTitle: 'voltage [pu]', datasets: [
        { label: '|v_c|', color: C.violet }, { label: 'limit m·V_dc', color: C.rose, dash: [5, 4], width: 1.2 }, { label: 'v_g', color: C.slate, width: 1.2, stepped: true }
      ] })
    };
    let res = null;
    function params() {
      const v = ctl.get();
      return {
        mode: v.mode, T: v.T, BWi: v.BWi, fsw: v.fsw * 1000, X: v.X, R: v.R, decouple: v.decouple, ffV: v.ffV,
        idStep: { t: 0.02, val: v.idVal }, iqStep: { t: v.mode === 'vdc' ? 0.09 : 0.08, val: v.iqVal },
        H: v.H / 1000, BWv: v.BWv, zeta: v.zeta, ffP: v.ffP, pdcStep: { t: 0.03, val: v.pdcVal },
        gridDip: { on: v.dipOn, t: v.dipT / 1000, dur: v.dipDur / 1000, depth: v.dipDepth }
      };
    }
    function run() {
      const v = ctl.get();
      res = M.vscSim(params());
      const s = res.series, k = res.kpi, g = res.gains, T = s.t[s.t.length - 1] * 1000;
      setData(ch.i, [xy(s.t, s.id, 1000), xy(s.t, s.idRef, 1000), xy(s.t, s.iq, 1000), xy(s.t, s.iqRef, 1000)]);
      setData(ch.vdc, [xy(s.t, s.Vdc, 1000), hline(0, T, 1.05), hline(0, T, 0.95), xy(s.t, s.Pac, 1000), xy(s.t, s.Pdc, 1000)]);
      setData(ch.vc, [xy(s.t, s.vcm, 1000), xy(s.t, s.vmax, 1000), xy(s.t, s.vg, 1000)]);
      const delayPh = 2 * Math.PI * v.BWi * g.Tdel * 180 / Math.PI;
      setKpis('vsc', [
        { label: 'Current PI K_p / K_i', value: `${f(g.Kp, 2)} / ${f(g.Ki, 1)}`, sub: 'IMC: α_c·L, α_c·R', tone: 'sky' },
        { label: 'i_d rise 10–90 %', value: k.rise ? f(k.rise * 1000, 2, ' ms') : '—', sub: `ideal ${f(2.2 / (2 * Math.PI * v.BWi) * 1000, 2)} ms`, tone: 'plain' },
        { label: 'i_q cross-coupling', value: v.mode === 'current' ? f(k.cross, 3, ' pu') : '—', tone: k.cross > 0.1 ? 'warn' : 'ok' },
        { label: 'Dead-time phase at α_c', value: f(delayPh, 0, '°'), sub: `T_del ${f(g.Tdel * 1000, 2)} ms`, tone: delayPh > 45 ? 'bad' : delayPh > 30 ? 'warn' : 'ok' },
        { label: 'V_dc PI K_p / K_i', value: `${f(g.Kpv, 2)} / ${f(g.Kiv, 0)}`, tone: 'ind' },
        { label: 'Max V_dc deviation', value: v.mode === 'vdc' ? f(k.vdcDev * 100, 2, ' %') : 'stiff DC', tone: k.vdcDev > 0.1 ? 'bad' : k.vdcDev > 0.05 ? 'warn' : 'ok' },
        { label: 'V_dc settling (1 %)', value: v.mode === 'vdc' && k.settle ? f(k.settle * 1000, 1, ' ms') : '—', tone: 'plain' },
        { label: 'Voltage-limited time', value: f(k.satTime * 1000, 1, ' ms'), tone: k.satTime > 0.005 ? 'warn' : 'plain' }
      ]);
    }
    const ctl = buildControls('vsc', '[data-controls="vsc"]', schema, run);
    buildPresets('[data-presets="vsc"]', presets, p => ctl.set({ ...ctl.defaults, ...p.v }));
    buildToolbar('vsc', { csv: () => res && download('vsc_dq_control.csv', csvOf({ t: 't_s', id: 'id_pu', idRef: 'id_ref_pu', iq: 'iq_pu', iqRef: 'iq_ref_pu', vcd: 'vcd_pu', vcq: 'vcq_pu', Vdc: 'Vdc_pu', Pac: 'Pac_pu', Pdc: 'Pdc_pu' }, res.series)) });
    MODULES.vsc = { ctl, run };
    run();
  }

  /* ================================================================
     MODULE 6 — PYTHON (Pyodide)
  ================================================================ */
  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.js';
  const PY_SCRIPTS = {
    'LCC current control — step response': `"""LCC-HVDC rectifier current control: step response (explicit Euler, per unit).
Same equations as module 1 of the lab, written out in plain NumPy."""
import numpy as np
import matplotlib.pyplot as plt

p = dict(Kp=6.8, Ti=0.028, L=0.010, Rd=0.03, dx=0.08, gamma_ref=18.0,
         Td=0.00083, alpha_min=5.0, I0=0.6, I1=0.7, t_step=0.02, T=0.15)

d2r = np.pi / 180
Vdo = 1 / (np.cos(p['gamma_ref'] * d2r) - p['dx'])   # inverter gives 1.0 pu at rated Id
Rc = p['dx'] * Vdo
dt = 2e-5
n = int(p['T'] / dt)
nd = max(1, int(round(p['Td'] / dt)))               # firing dead time in samples

def vdi(I):                                         # inverter on CEA (gamma = gamma_ref)
    return Vdo * np.cos(p['gamma_ref'] * d2r) - Rc * I

I = p['I0']
alpha0 = np.arccos((vdi(I) + p['Rd'] * I + Rc * I) / Vdo)
x = np.pi / 2 - alpha0                              # integrator state
buf = [alpha0] * nd
t = np.arange(n) * dt
Id, A, Iord = np.zeros(n), np.zeros(n), np.zeros(n)
for k in range(n):
    iord = p['I1'] if t[k] >= p['t_step'] else p['I0']
    e = iord - I
    a = np.pi / 2 - (p['Kp'] * e + x)
    a_lim = min(max(a, p['alpha_min'] * d2r), 150 * d2r)
    if a == a_lim or (a < a_lim and e < 0) or (a > a_lim and e > 0):
        x += p['Kp'] / p['Ti'] * e * dt             # conditional integration (anti-windup)
    buf.append(a_lim)
    a_act = buf.pop(0)
    Vdr = Vdo * np.cos(a_act) - Rc * I
    I = max(0.0, I + dt / p['L'] * (Vdr - vdi(I) - p['Rd'] * I))
    Id[k], A[k], Iord[k] = I, a_act / d2r, iord

after = t >= p['t_step']
dI = p['I1'] - p['I0']
overshoot = 100 * (Id[after].max() - p['I1']) / dI
outside = np.abs(Id - p['I1']) > 0.02 * abs(dI)
settle = t[np.where(outside)[0][-1]] - p['t_step'] if outside.any() else 0.0
print(f"Vdo = {Vdo:.3f} pu, alpha0 = {alpha0 / d2r:.2f} deg")
print(f"overshoot = {overshoot:.1f} %,  2 % settling time = {settle * 1e3:.1f} ms")

fig, ax = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
ax[0].plot(t * 1e3, Iord, 'k--', lw=1, label='I_ord')
ax[0].plot(t * 1e3, Id, lw=2, label='I_d')
ax[0].set_ylabel('current [pu]'); ax[0].legend(); ax[0].grid(alpha=.3)
ax[1].plot(t * 1e3, A, color='tab:orange', lw=2)
ax[1].set_ylabel('alpha [deg]'); ax[1].set_xlabel('time [ms]'); ax[1].grid(alpha=.3)
fig.suptitle('Rectifier current-control step response')
plt.tight_layout()
`,
    'Current loop — Bode & margins': `"""Open-loop frequency response of the LCC current loop and its stability margins."""
import numpy as np
import matplotlib.pyplot as plt

Kp, Ti = 6.8, 0.028                     # PI gains [rad/pu, s]
L, Rd, dx, gamma_ref, alpha0 = 0.010, 0.03, 0.08, 18.0, 15.0
Td, Tm = 0.00083, 0.001                 # dead time and measurement filter [s]

d2r = np.pi / 180
Vdo = 1 / (np.cos(gamma_ref * d2r) - dx)
Ka = Vdo * np.sin(alpha0 * d2r)         # dVdr/dalpha at the operating point
w = np.logspace(0, 4.3, 4000)
s = 1j * w
C = Kp * (1 + 1 / (s * Ti))
G = Ka * np.exp(-s * Td) / ((Rd + s * L) * (1 + s * Tm))   # CEA inverter -> R_eq = Rd
Lo = C * G
mag = 20 * np.log10(np.abs(Lo))
ph = np.unwrap(np.angle(Lo)) * 180 / np.pi

ic = np.where(np.diff(np.sign(mag)))[0][0]
wc, pm = w[ic], 180 + ph[ic]
i180 = np.where(np.diff(np.sign(ph + 180)))[0]
gm = -mag[i180[0]] if len(i180) else np.inf
print(f"crossover  wc = {wc:.1f} rad/s  ({wc / 2 / np.pi:.1f} Hz)")
print(f"phase margin = {pm:.1f} deg,  gain margin = {gm:.1f} dB")

fig, ax = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
ax[0].semilogx(w, mag); ax[0].axhline(0, color='k', lw=.8); ax[0].axvline(wc, ls='--', color='tab:red')
ax[0].set_ylabel('|L(jw)| [dB]'); ax[0].grid(which='both', alpha=.3)
ax[1].semilogx(w, ph); ax[1].axhline(-180, color='k', lw=.8); ax[1].axvline(wc, ls='--', color='tab:red')
ax[1].set_ylabel('phase [deg]'); ax[1].set_xlabel('w [rad/s]'); ax[1].grid(which='both', alpha=.3)
ax[1].set_ylim(max(ph.min(), -360), 0)
fig.suptitle(f'Current loop: PM = {pm:.0f} deg, GM = {gm:.1f} dB')
plt.tight_layout()
`,
    'Reactive power & filter schedule': `"""Converter reactive power vs load and the number of filter banks to balance it."""
import numpy as np
import matplotlib.pyplot as plt

alpha, dx = 15.0, 0.08            # control angle [deg], relative inductive drop
Qb, SCR = 0.12, 5.0               # bank size [pu], short-circuit ratio
d2r = np.pi / 180

def q_conv(P, U=1.0):
    a = alpha * d2r
    am = np.arccos(np.clip(np.cos(a) - 2 * dx * P / U, -1, 1))   # alpha + mu
    mu = np.maximum(am - a, 1e-9)
    return P * (2 * mu + np.sin(2 * a) - np.sin(2 * am)) / (np.cos(2 * a) - np.cos(2 * am))

P = np.linspace(0.05, 1.0, 20)
Q = q_conv(P)
banks = np.round(Q / Qb).astype(int)
print(' P [pu] | Q_conv [pu] | Q/P  | banks for Q_ex~0 | Q_ex [pu]')
for p_, q_, n_ in zip(P, Q, banks):
    print(f'  {p_:5.2f} |   {q_:6.3f}    | {q_ / p_:4.2f} |       {n_:2d}         | {n_ * Qb - q_:+6.3f}')
print(f'\\nvoltage step per bank switching ~ {100 * Qb / SCR:.1f} %')

fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(P, Q, lw=2, label='converter Q absorbed')
ax.step(P, banks * Qb, where='mid', label='filter Q (banks x Qb)')
ax.set_xlabel('P [pu]'); ax.set_ylabel('Q [pu]'); ax.grid(alpha=.3); ax.legend()
ax.set_title('Reactive power demand and filter schedule')
plt.tight_layout()
`,
    'VDCOL & static Vd–Id characteristics': `"""Rectifier/inverter static characteristics with VDCOL and current margin."""
import numpy as np
import matplotlib.pyplot as plt

dx, gamma_ref, alpha_min, Rd = 0.08, 18.0, 5.0, 0.03
Iord, dI = 1.0, 0.1
Vhigh, Vlow, Imin = 0.8, 0.3, 0.3
d2r = np.pi / 180
Vdo = 1 / (np.cos(gamma_ref * d2r) - dx)
Rc = dx * Vdo

def vdcol(V):
    return np.where(V <= Vlow, Imin, np.where(V >= Vhigh, 1.2, Imin + (1 - Imin) * (V - Vlow) / (Vhigh - Vlow)))

Id = np.linspace(0, 1.2, 400)
cia = Vdo * np.cos(alpha_min * d2r) - Rc * Id               # rectifier at alpha_min
cea = Vdo * np.cos(gamma_ref * d2r) - Rc * Id + Rd * Id     # inverter CEA referred to the rectifier
V = np.linspace(0, 1.15, 400)
fig, ax = plt.subplots(figsize=(7, 4.5))
ax.plot(Id, cia, label='rectifier CIA (alpha_min)')
ax.plot(np.minimum(Iord, vdcol(V)), V, label='rectifier CC + VDCOL')
ax.plot(Id, cea, label='inverter CEA')
ax.plot(np.minimum(Iord - dI, vdcol(V) - dI), V, '--', label='inverter CC (I_ord - dI)')
ax.set_xlim(0, 1.25); ax.set_ylim(0, 1.2)
ax.set_xlabel('I_d [pu]'); ax.set_ylabel('V_d at rectifier [pu]'); ax.grid(alpha=.3); ax.legend(loc='lower left')
ax.set_title('LCC-HVDC static characteristics')
plt.tight_layout()
print(f'Vdo = {Vdo:.3f} pu, Rc = {Rc:.4f} pu')
`,
    'Blank': `import numpy as np
import matplotlib.pyplot as plt

# your HVDC study here
`
  };
  function initPy() {
    const sel = $('#py-preset'), code = $('#py-code'), out = $('#py-out'), stat = $('#py-status'), fig = $('#py-fig');
    sel.innerHTML = Object.keys(PY_SCRIPTS).map(k => `<option>${k}</option>`).join('');
    code.value = PY_SCRIPTS[sel.value];
    sel.addEventListener('change', () => { code.value = PY_SCRIPTS[sel.value]; });
    code.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('    ', s, code.selectionEnd, 'end'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runPy(); }
    });
    $('#py-inject').addEventListener('click', () => {
      if (!MODULES.pole) initModule('pole');
      const pj = JSON.stringify(MODULES.pole.getParams(), null, 2).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None');
      code.value = `# Parameters exported from the Pole Control simulator (per unit, seconds)\nlab = ${pj}\n\n` + code.value;
      toast('Pole Control parameters inserted as `lab`');
    });
    let py = null, loading = null;
    function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
    async function getPy() {
      if (py) return py;
      if (!loading) loading = (async () => {
        stat.textContent = 'loading Pyodide…';
        if (!window.loadPyodide) await loadScript(PYODIDE_URL);
        const inst = await window.loadPyodide();
        stat.textContent = 'loading NumPy + Matplotlib…';
        await inst.loadPackage(['numpy', 'matplotlib']);
        inst.setStdout({ batched: s => { out.textContent += s + '\n'; } });
        inst.setStderr({ batched: s => { out.textContent += s + '\n'; } });
        await inst.runPythonAsync("import matplotlib\nmatplotlib.use('Agg')");
        py = inst; return inst;
      })();
      return loading;
    }
    async function runPy() {
      const btn = $('#py-run'); btn.disabled = true; btn.classList.add('opacity-60');
      out.textContent = ''; const t0 = performance.now();
      try {
        const inst = await getPy();
        stat.textContent = 'running…';
        await inst.runPythonAsync(code.value);
        const imgs = inst.runPython(`
import io, base64
import matplotlib.pyplot as _plt
_out = []
for _n in _plt.get_fignums():
    _b = io.BytesIO(); _plt.figure(_n).savefig(_b, format='png', dpi=110, bbox_inches='tight')
    _out.append(base64.b64encode(_b.getvalue()).decode())
_plt.close('all')
_out`).toJs();
        fig.innerHTML = imgs.length ? imgs.map(b => `<img alt="Matplotlib figure" class="w-full rounded-lg bg-white" src="data:image/png;base64,${b}"/>`).join('') : '<span class="p-6">No figure produced</span>';
        stat.textContent = `done in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      } catch (err) {
        out.textContent += String(err && err.message ? err.message : err);
        stat.textContent = 'error';
      } finally { btn.disabled = false; btn.classList.remove('opacity-60'); }
    }
    $('#py-run').addEventListener('click', runPy);
    MODULES.py = { run: () => {} };
  }

  /* ------------------------------------------------------ module routing */
  const INIT = { pole: initPole, tune: initTune, cf: initCF, rpc: initRPC, vsc: initVSC, py: initPy };
  function initModule(m) { if (!MODULES[m] && INIT[m]) { INIT[m](); icons(); } }
  function showModule(m) {
    if (!INIT[m]) m = 'pole';
    $$('.mod').forEach(s => s.classList.toggle('hidden', s.id !== `mod-${m}`));
    $$('.mod-tab').forEach(b => {
      const on = b.dataset.mod === m;
      b.classList.toggle('bg-white', on); b.classList.toggle('dark:bg-slate-800', on); b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-grid-700', on); b.classList.toggle('dark:text-sky-400', on);
      b.classList.toggle('text-slate-600', !on); b.classList.toggle('dark:text-slate-400', !on);
    });
    initModule(m);
    CHARTS.forEach(c => c.resize());
  }

  function boot() {
    if (EMBED) {
      document.body.classList.add('embed');
      const link = $('#embed-link'); link.classList.remove('hidden');
      $('a', link).href = `${location.pathname}${location.hash || `#m=${EMBED}`}`;
    }
    $$('.mod-tab').forEach(b => b.addEventListener('click', () => {
      showModule(b.dataset.mod);
      history.replaceState(null, '', `#m=${b.dataset.mod}`);
    }));
    $('#theme-toggle-btn').addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('gridpulse-theme', isDark() ? 'dark' : 'light'); } catch (e) { /* noop */ }
      applyChartTheme();
    });
    const h = parseHash() || {};
    const mod = EMBED || h.m || 'pole';
    showModule(mod);
    if (MODULES[mod] && MODULES[mod].ctl) {
      const vals = { ...h }; delete vals.m;
      if (Object.keys(vals).length) MODULES[mod].ctl.set(vals);
    }
    icons();
    const math = () => { if (window.renderMathInElement) renderMathInElement(document.body, { delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); };
    if (document.readyState === 'complete') math(); else window.addEventListener('load', math);
    if (EMBED && window.parent !== window) {
      const post = () => window.parent.postMessage({ gridpulseHeight: document.documentElement.scrollHeight }, '*');
      new ResizeObserver(post).observe(document.body); post();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
