/*!
 * GridPulse HVDC controller models — v1.0
 * Pure, dependency-free JavaScript (runs in the browser and in Node.js).
 * Educational per-unit models of LCC-HVDC pole control, current-loop tuning,
 * commutation-failure margin, reactive-power / filter switching, and VSC dq control.
 * Licence: MIT. Not a substitute for EMT studies (PSCAD/EMTP/OpenModelica/ParaEMT).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVDCModels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const acosC = x => Math.acos(clamp(x, -1, 1));

  /** Ideal no-load DC voltage chosen so that the inverter delivers 1.0 pu at rated current in CEA. */
  function vdo0Of(gammaRefDeg, dx) {
    return 1 / (Math.cos(gammaRefDeg * D2R) - dx);
  }

  function mergeDeep(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!over) return out;
    for (const k of Object.keys(over)) {
      const v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') out[k] = mergeDeep(base[k], v);
      else if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /* ======================================================================
     1. LCC POLE CONTROL — time domain
     Rectifier: PI current control (CC) with alpha limits & anti-windup
     Inverter : predictive CEA (gamma control) + current control with margin dI
     VDCOL, power-order ramp, commutation failure, DC-line fault + restart.
  ====================================================================== */
  const POLE_DEFAULTS = {
    T: 1.0, dt: 2e-5, nOut: 1600,
    L: 0.010,          // DC-circuit inductance  [s·pu]  (L / Zbase)
    Rd: 0.03,          // DC line resistance [pu]
    dx: 0.08,          // relative inductive voltage drop at rated Id
    alphaMin: 5, alphaMax: 150, retardAngle: 140,
    gammaRef: 18, gammaCF: 7.2, cfDuration: 0.02,
    margin: 0.10,      // current margin dI [pu]
    Kp: 6.8, Ti: 0.028,          // rectifier CC  [rad/pu, s]
    KpI: 0.8, TiI: 0.02,         // inverter CC   [rad/pu, s]
    Td: 0.00083,       // firing / sampling dead time [s]
    Tm: 0.001,         // Id measurement filter [s]
    Tk: 0.008,         // inverter AC-voltage measurement filter used by CEA prediction [s]
    vdcol: { on: true, Vhigh: 0.8, Vlow: 0.3, Imin: 0.3, Tup: 0.04, Tdown: 0.005 },
    Imax: 1.2, Iabsmin: 0.1,
    P0: 1.0,
    ramp: { on: true, t: 0.1, P1: 0.7, rate: 5 },             // pu/s
    rectDip: { on: false, t: 0.25, dur: 0.15, depth: 0.2 },
    invDip: { on: false, t: 0.25, dur: 0.10, depth: 0.15, phi: 0 },   // phi: commutation-voltage phase shift [deg]
    dcFault: { on: false, t: 0.25, x: 0.5, Rf: 0.02, permanent: false, tDetect: 0.003, deion: 0.15, restartRate: 4, maxRestarts: 2 },
    cfPrev: { on: false, gain: 60, kPhi: 1.5, Tslow: 0.05 }   // extra gamma: deg per pu dip, deg per deg phase jump
  };

  const MODE_LABELS = [
    'Rect CC · Inv CEA',
    'Mode shift: Inv CC · Rect α-min',
    'Commutation failure',
    'DC-fault retard / deionisation',
    'Pole blocked'
  ];

  function simPoleControl(userParams) {
    const p = mergeDeep(POLE_DEFAULTS, userParams);
    const dt = p.dt;
    const n = Math.max(10, Math.round(p.T / dt));
    const every = Math.max(1, Math.floor(n / p.nOut));
    const Vdo = vdo0Of(p.gammaRef, p.dx);
    const Rc = p.dx * Vdo;
    const aMin = p.alphaMin * D2R, aMax = p.alphaMax * D2R;
    const gRef = p.gammaRef * D2R, gCF = p.gammaCF * D2R;
    const cosGcf = Math.cos(gCF);

    // ---- steady-state initialisation at P0 ----
    let Id = Math.max(0.15, p.P0), Vdr = 1, Vdi = 1;
    for (let k = 0; k < 30; k++) {
      Vdi = Vdo * Math.cos(gRef) - Rc * Id;
      Vdr = Vdi + p.Rd * Id;
      Id = clamp(p.P0 / Vdr, p.Iabsmin, p.Imax);
    }
    let alpha0 = acosC((Vdr + Rc * Id) / Vdo);
    if (alpha0 < aMin) alpha0 = aMin;
    const beta0 = acosC(Math.cos(gRef) - 2 * p.dx * Id);

    // states
    let Idr = Id, Idi = Id;
    let IdmR = Id, IdmI = Id;
    let xr = Math.PI / 2 - alpha0;   // rectifier integrator (rad)
    let xi = 0;                       // inverter CC integrator (rad)
    let kiF = 1, kiSlow = 1;
    let VdF = Vdr, VdPF = Vdr;       // VDCOL and power-controller filtered Vd
    let Pord = p.P0;
    const nDelay = Math.max(1, Math.round(p.Td / dt));
    const bufA = new Float64Array(nDelay).fill(alpha0);
    const bufB = new Float64Array(nDelay).fill(beta0);
    let bi = 0;

    // event bookkeeping
    let inCF = false, cfEnd = -1, cfCount = 0;
    const F = p.dcFault;
    let faultActive = false, faultStruck = false, retard = false, retardEnd = -1, detectAt = -1;
    let restarts = 0, blocked = false, restartAt = -1;
    const Lr = p.L * (0.25 + 0.5 * F.x), Li = p.L - Lr;
    const Rr = p.Rd * F.x, Ri = p.Rd - Rr;

    const out = { t: [], Pord: [], dg: [], Idr: [], Idi: [], Iord: [], Vdr: [], Vdi: [], alpha: [], gamma: [], beta: [], Pd: [], mode: [], vdcol: [], kr: [], ki: [] };
    let minGamma = 999, peakId = 0, vdcolTime = 0, shiftTime = 0, cfTime = 0;
    let gammaDisp = p.gammaRef, mode = 0, vdcolActive = false, Iord = Id;

    for (let s = 0; s <= n; s++) {
      const t = s * dt;

      // --- AC-side events ---
      const rD = p.rectDip, iD = p.invDip;
      const kr = rD.on && t >= rD.t && t < rD.t + rD.dur ? 1 - rD.depth : 1;
      const ki = iD.on && t >= iD.t && t < iD.t + iD.dur ? Math.max(1e-3, 1 - iD.depth) : 1;
      kiF += (dt / p.Tk) * (ki - kiF);
      kiSlow += (dt / p.cfPrev.Tslow) * (ki - kiSlow);

      // --- measurements ---
      IdmR += (dt / p.Tm) * (Idr - IdmR);
      IdmI += (dt / p.Tm) * (Idi - IdmI);
      const tau = Vdr < VdF ? p.vdcol.Tdown : p.vdcol.Tup;
      VdF += (dt / tau) * (Vdr - VdF);
      VdPF += (dt / 0.02) * (Vdr - VdPF);

      // --- power order ramp ---
      const target = p.ramp.on && t >= p.ramp.t ? p.ramp.P1 : p.P0;
      const dP = p.ramp.rate * dt;
      Pord += clamp(target - Pord, -dP, dP);

      // --- VDCOL & current order ---
      const IordP = Pord / Math.max(VdPF, 0.4);
      let Ilim = p.Imax;
      if (p.vdcol.on) {
        const V = p.vdcol;
        if (VdF <= V.Vlow) Ilim = V.Imin;
        else if (VdF < V.Vhigh) Ilim = V.Imin + (1.0 - V.Imin) * (VdF - V.Vlow) / (V.Vhigh - V.Vlow);
        else Ilim = p.Imax;
      }
      Iord = Math.min(IordP, Ilim, p.Imax);
      vdcolActive = p.vdcol.on && Ilim < IordP - 1e-3;
      if (restartAt >= 0) Iord = Math.min(Iord, p.Iabsmin + F.restartRate * (t - restartAt));
      Iord = clamp(Iord, p.Iabsmin, p.Imax);
      if (blocked) Iord = 0;

      // --- DC line fault logic ---
      if (F.on && !faultStruck && t >= F.t) { faultActive = true; faultStruck = true; detectAt = t + F.tDetect; }
      if (faultActive && !retard && detectAt >= 0 && t >= detectAt && !blocked) {
        retard = true; retardEnd = t + F.deion; detectAt = -1; restartAt = -1;
      }
      if (retard && t >= retardEnd) {
        retard = false;
        if (faultActive && F.permanent) {
          restarts++;
          if (restarts > F.maxRestarts) { blocked = true; restarts = F.maxRestarts; }
          else { restartAt = t; detectAt = t + F.tDetect + 0.01; }
        } else {
          restartAt = t;
        }
        // re-initialise rectifier integrator for a soft restart from alpha-max
        xr = Math.PI / 2 - 100 * D2R;
      }

      // --- rectifier current controller ---
      let aOrd;
      if (blocked || retard) {
        aOrd = blocked ? aMax : p.retardAngle * D2R;
      } else {
        const e = Iord - IdmR;
        const u = p.Kp * e + xr;
        aOrd = Math.PI / 2 - u;
        let integrate = true;
        if (aOrd < aMin) { aOrd = aMin; if (e > 0) integrate = false; }
        if (aOrd > aMax) { aOrd = aMax; if (e < 0) integrate = false; }
        if (integrate) xr += (p.Kp / p.Ti) * e * dt;
      }

      // --- inverter controller: CC (with margin) acting on top of CEA ---
      const ei = (Iord - p.margin) - IdmI;
      xi = clamp(xi + (p.KpI / p.TiI) * ei * dt, 0, 70 * D2R);
      const yi = clamp(p.KpI * ei + xi, 0, 70 * D2R);
      const phiNow = ki < 1 ? Math.abs(p.invDip.phi || 0) : 0;   // phase-jump detected by abc→αβ / zero-sequence logic
      const boost = p.cfPrev.on ? (p.cfPrev.gain * Math.max(0, kiSlow - ki) + p.cfPrev.kPhi * phiNow) * D2R : 0;
      const gOrd = gRef + yi + boost;
      const bOrd = clamp(acosC(Math.cos(gOrd) - 2 * p.dx * IdmI / Math.max(kiF, 0.05)), gOrd, 89 * D2R);

      // --- firing dead time ---
      const aAct = bufA[bi], bAct = bufB[bi];
      bufA[bi] = aOrd; bufB[bi] = bOrd; bi = (bi + 1) % nDelay;

      // --- converter DC voltages ---
      Vdr = blocked ? 0 : kr * Vdo * Math.cos(aAct) - Rc * Idr;
      const bEff = bAct + (ki < 1 ? (iD.phi || 0) * D2R : 0);
      if (inCF && t >= cfEnd) inCF = false;
      if (!inCF) {
        const arg = Math.cos(bEff) + 2 * p.dx * Idi / ki;
        if (Idi > 0.02 && arg >= cosGcf) {
          inCF = true; cfEnd = t + p.cfDuration; cfCount++;
        } else {
          gammaDisp = Idi > 0.02 ? acosC(arg) * R2D : bEff * R2D;
        }
      }
      if (inCF) { Vdi = 0; gammaDisp = 0; }
      else Vdi = ki * Vdo * Math.cos(bEff) + Rc * Idi;

      // --- DC circuit ---
      if (faultActive) {
        const Vf = F.Rf * (Idr - Idi);
        Idr = Math.max(0, Idr + (dt / Lr) * (Vdr - Rr * Idr - Vf));
        Idi = Math.max(0, Idi + (dt / Li) * (Vf - Vdi - Ri * Idi));
        if (!F.permanent && retard && Idr < 1e-3) {       // arc extinguished
          faultActive = false;
          const m = (Lr * Idr + Li * Idi) / p.L; Idr = Idi = m;
        }
      } else {
        const I = Math.max(0, Idr + (dt / p.L) * (Vdr - Vdi - p.Rd * Idr));
        Idr = Idi = I;
      }

      // --- mode classification ---
      if (blocked) mode = 4;
      else if (retard || faultActive) mode = 3;
      else if (inCF) mode = 2;
      else if (yi > 0.5 * D2R && aOrd <= aMin + 1e-6) mode = 1;
      else if (yi > 2 * D2R) mode = 1;
      else mode = 0;

      if (!inCF && !retard && !blocked && Idi > 0.05) minGamma = Math.min(minGamma, gammaDisp);
      peakId = Math.max(peakId, Idr);
      if (vdcolActive) vdcolTime += dt;
      if (mode === 1) shiftTime += dt;
      if (mode === 2) cfTime += dt;

      if (s % every === 0) {
        out.t.push(t); out.Pord.push(Pord); out.dg.push((yi + boost) * R2D); out.Idr.push(Idr); out.Idi.push(Idi); out.Iord.push(Iord);
        out.Vdr.push(Vdr); out.Vdi.push(Vdi);
        out.alpha.push(aAct * R2D); out.gamma.push(gammaDisp); out.beta.push(bAct * R2D);
        out.Pd.push(Vdr * Idr); out.mode.push(mode); out.vdcol.push(vdcolActive ? 1 : 0);
        out.kr.push(kr); out.ki.push(ki);
      }
    }

    // ---- KPIs ----
    const evStarts = [], evEnds = [];
    if (p.rectDip.on) { evStarts.push(p.rectDip.t); evEnds.push(p.rectDip.t + p.rectDip.dur); }
    if (p.invDip.on) { evStarts.push(p.invDip.t); evEnds.push(p.invDip.t + p.invDip.dur); }
    if (F.on) { evStarts.push(F.t); evEnds.push(F.t + F.tDetect + F.deion); }
    let recovery = null, Ppre = null;
    if (evStarts.length) {
      const t0 = Math.min(...evStarts), t1 = Math.max(...evEnds);
      let iPre = 0; while (iPre < out.t.length - 1 && out.t[iPre + 1] < t0) iPre++;
      Ppre = out.Pd[iPre];
      let found = null;
      for (let i = out.t.length - 1; i >= 0 && out.t[i] >= t1; i--) {
        if (out.Pd[i] < 0.9 * Ppre) break;
        found = out.t[i];
      }
      recovery = found !== null && !blocked ? found - t1 : null;
    }
    let overshoot = null;
    if (p.ramp.on && !evStarts.length) {
      const I1 = out.Iord[out.Iord.length - 1];
      const I0 = out.Iord[0];
      const dI = I1 - I0;
      if (Math.abs(dI) > 0.02) {
        let ext = 0;
        for (let i = 0; i < out.t.length; i++) if (out.t[i] >= p.ramp.t) ext = Math.max(ext, (out.Idr[i] - I1) * Math.sign(dI));
        overshoot = 100 * ext / Math.abs(dI);
      }
    }
    return {
      params: p, series: out, Vdo, Rc, alpha0: alpha0 * R2D, beta0: beta0 * R2D,
      kpi: {
        minGamma: minGamma === 999 ? null : minGamma, cfCount, peakId, vdcolTime, shiftTime, cfTime,
        restarts, blocked, recovery, Ppre, overshoot,
        final: { Id: Idr, Vd: Vdr, P: Vdr * Idr, alpha: out.alpha[out.alpha.length - 1], gamma: gammaDisp }
      }
    };
  }

  /* ======================================================================
     2. CURRENT-LOOP TUNING — frequency response & step
     L(s) = Kp(1+1/sTi) · Vdo·sin(α0) · e^{-sTd} / ((R + sL)(1 + sTm))
  ====================================================================== */
  const BODE_DEFAULTS = { Kp: 6.8, Ti: 0.028, alpha0: 15, L: 0.010, Rd: 0.03, dx: 0.08, gammaRef: 18, Td: 0.00083, Tm: 0.001, invMode: 'CEA', wMin: 1, wMax: 2e4, nPts: 500 };

  function plantOf(p) {
    const Vdo = vdo0Of(p.gammaRef, p.dx), Rc = p.dx * Vdo;
    const R = p.invMode === 'CEA' ? p.Rd : p.Rd + 2 * Rc;   // CEA inverter behaves as a negative commutation resistance
    const Ka = Vdo * Math.sin(p.alpha0 * D2R);
    return { Vdo, Rc, R, Ka };
  }

  function loopAt(p, pl, w) {
    const piMag = p.Kp * Math.sqrt(1 + 1 / Math.pow(w * p.Ti, 2));
    const piPh = -Math.atan(1 / (w * p.Ti));
    const gMag = pl.Ka / (Math.hypot(pl.R, w * p.L) * Math.hypot(1, w * p.Tm));
    const gPh = -w * p.Td - Math.atan2(w * p.L, pl.R) - Math.atan(w * p.Tm);
    return { mag: piMag * gMag, ph: piPh + gPh, gMag, gPh };
  }

  function bodeCC(userParams) {
    const p = { ...BODE_DEFAULTS, ...userParams };
    const pl = plantOf(p);
    const w = [], magDb = [], phDeg = [], plantDb = [], plantPh = [];
    for (let i = 0; i < p.nPts; i++) {
      const wi = p.wMin * Math.pow(p.wMax / p.wMin, i / (p.nPts - 1));
      const r = loopAt(p, pl, wi);
      w.push(wi); magDb.push(20 * Math.log10(r.mag)); phDeg.push(r.ph * R2D);
      plantDb.push(20 * Math.log10(r.gMag)); plantPh.push(r.gPh * R2D);
    }
    let wc = null, pm = null, w180 = null, gm = null;
    for (let i = 1; i < w.length; i++) {
      if (wc === null && magDb[i - 1] >= 0 && magDb[i] < 0) {
        const f = magDb[i - 1] / (magDb[i - 1] - magDb[i]);
        wc = w[i - 1] * Math.pow(w[i] / w[i - 1], f);
        pm = 180 + loopAt(p, pl, wc).ph * R2D;
      }
      if (w180 === null && phDeg[i - 1] > -180 && phDeg[i] <= -180) {
        const f = (phDeg[i - 1] + 180) / (phDeg[i - 1] - phDeg[i]);
        w180 = w[i - 1] * Math.pow(w[i] / w[i - 1], f);
        gm = -20 * Math.log10(loopAt(p, pl, w180).mag);
      }
    }
    const step = stepCC(p, pl, wc);
    const stable = (pm === null || pm > 0) && (gm === null || gm > 0) && step.stable;
    return { params: p, plant: pl, w, magDb, phDeg, plantDb, plantPh, wc, pm, w180, gm, step, stable };
  }

  function stepCC(p, pl, wc) {
    const T = clamp(wc ? 18 / wc : 0.12, 0.03, 0.6), dt = clamp(T / 20000, 2e-6, 2e-5), n = Math.round(T / dt);
    const nD = Math.max(1, Math.round(p.Td / dt));
    const buf = new Float64Array(nD); let bi = 0;
    let I = 0, Im = 0, x = 0;
    const t = [], y = [], u = [];
    const every = Math.max(1, Math.floor(n / 800));
    let peak = 0, stable = true;
    for (let s = 0; s <= n; s++) {
      const e = 1 - Im;                 // unit reference step
      const cmd = p.Kp * e + x;
      x += (p.Kp / p.Ti) * e * dt;
      const del = buf[bi]; buf[bi] = cmd; bi = (bi + 1) % nD;
      I += (dt / p.L) * (pl.Ka * del - pl.R * I);
      Im += (dt / p.Tm) * (I - Im);
      if (!isFinite(I) || Math.abs(I) > 50) { stable = false; break; }
      peak = Math.max(peak, I);
      if (s % every === 0) { t.push(s * dt); y.push(I); u.push(cmd); }
    }
    let rise = null, settle = null;
    if (stable) {
      let t10 = null, t90 = null;
      for (let i = 0; i < y.length; i++) {
        if (t10 === null && y[i] >= 0.1) t10 = t[i];
        if (t90 === null && y[i] >= 0.9) { t90 = t[i]; break; }
      }
      rise = t10 !== null && t90 !== null ? t90 - t10 : null;
      for (let i = y.length - 1; i >= 0; i--) { if (Math.abs(y[i] - 1) > 0.02) { settle = i < y.length - 1 ? t[i + 1] : null; break; } }
      if (Math.abs(y[y.length - 1] - 1) > 0.05) stable = Math.abs(y[y.length - 1] - 1) < 0.5 && peak < 3;
    }
    return { t, y, u, overshoot: stable ? Math.max(0, (peak - 1) * 100) : null, rise, settle, stable };
  }

  /** Analytic PI design for a target crossover wc [rad/s] and phase margin PM [deg]. */
  function autoTuneCC(userParams, wc, pmDeg) {
    const p = { ...BODE_DEFAULTS, ...userParams };
    const pl = plantOf(p);
    const r = loopAt({ ...p, Kp: 1, Ti: 1e9 }, pl, wc);
    const phiPI = -Math.PI + pmDeg * D2R - r.gPh;
    let Ti, note = '';
    if (phiPI >= -1e-3) { Ti = 1.0; note = 'Plant phase lag too small for a PI to add lag – using near-pure P.'; }
    else if (phiPI <= -89 * D2R) { Ti = 1 / (wc * Math.tan(89 * D2R)); note = 'Target needs >89° PI lag – crossover lowered by integral action.'; }
    else Ti = 1 / (wc * Math.tan(-phiPI));
    if (-r.gPh * R2D > 180 - pmDeg) note = 'Dead time + plant lag exceed 180°−PM at this crossover: reduce the target bandwidth.';
    const Kp = 1 / (r.gMag * Math.sqrt(1 + 1 / Math.pow(wc * Ti, 2)));
    return { Kp, Ti, note };
  }

  /* ======================================================================
     3. COMMUTATION-FAILURE MARGIN (inverter)
     cos γ = cos β' + 2·dx·Id'/k ,   β' = β0 + φ  (φ<0: commutation-voltage zero crossing advanced)
  ====================================================================== */
  function cfModel(userParams) {
    const p = { gamma0: 18, dx: 0.08, Id0: 1.0, surge: 1.0, dip: 0.15, phi: 0, tq: 400e-6, f: 50, ...userParams };
    const gCF = 2 * Math.PI * p.f * p.tq;           // rad
    const beta0 = acosC(Math.cos(p.gamma0 * D2R) - 2 * p.dx * p.Id0);
    const gammaAfter = (dip, phiDeg, surge = p.surge, b0 = beta0) => {
      const k = Math.max(1e-4, 1 - dip);
      const arg = Math.cos(b0 + phiDeg * D2R) + 2 * p.dx * p.Id0 * surge / k;
      return arg >= 1 ? 0 : Math.acos(arg) * R2D;
    };
    const critDip = (phiDeg, surge = p.surge, g0 = p.gamma0) => {
      const b0 = acosC(Math.cos(g0 * D2R) - 2 * p.dx * p.Id0);
      const den = Math.cos(gCF) - Math.cos(b0 + phiDeg * D2R);
      if (den <= 0) return 0;
      return clamp(1 - 2 * p.dx * p.Id0 * surge / den, 0, 1);
    };
    const g = gammaAfter(p.dip, p.phi);
    return {
      params: p, beta0: beta0 * R2D, mu0: beta0 * R2D - p.gamma0, gammaCF: gCF * R2D,
      gamma: g, margin: g - gCF * R2D, cf: g < gCF * R2D,
      critDipNow: critDip(p.phi), gammaAfter, critDip
    };
  }

  /* ======================================================================
     4. REACTIVE POWER CONTROL & AC-FILTER SWITCHING
  ====================================================================== */
  function convQ(P, alphaDeg, dx, Vac = 1) {
    if (P <= 1e-6) return 0;
    const a = alphaDeg * D2R;
    const Id = P;                                   // Vd held ≈ 1 pu by tap changers
    const am = acosC(Math.cos(a) - 2 * dx * Id / Vac);
    const mu = Math.max(1e-6, am - a);
    const num = 2 * mu + Math.sin(2 * a) - Math.sin(2 * am);
    const den = Math.cos(2 * a) - Math.cos(2 * am);
    return P * num / den;
  }

  const RPC_DEFAULTS = {
    nBanks: 6, Qb: 0.12, minFilter: [0.02, 0.5], angle: 15, dx: 0.08, SCR: 5.0,
    band: 0.08, bias: 0.0, mode: 'Q', Umin: 0.95, Umax: 1.05, V0: 1.0,
    Pmin: 0.1, Pmax: 1.0, rate: 0.05, dwell: 3, tsw: 1.0, dt: 0.05
  };

  function rpcSim(userParams) {
    const p = { ...RPC_DEFAULTS, ...userParams };
    const tUp = (p.Pmax - p.Pmin) / p.rate;
    const T = 2 * tUp + 2 * p.dwell;
    const out = { t: [], P: [], Qconv: [], Qfilt: [], Qexch: [], Vac: [], n: [], events: [] };
    let nOn = 0, tIn = 0, tOut = 0, ops = 0, maxDev = 0, vMax = 0, vMin = 9;
    const reqAt = P => p.minFilter.filter(th => P > th).length;
    const solve = (P, nb) => {
      let V = p.V0, Qc = 0, Qf = 0;
      for (let k = 0; k < 8; k++) {
        Qc = convQ(P, p.angle, p.dx, V);
        Qf = nb * p.Qb * V * V;
        V = p.V0 + (Qf - Qc) / p.SCR;
      }
      return { V, Qc, Qf, Qx: Qf - Qc };
    };
    nOn = Math.min(p.nBanks, reqAt(p.Pmin));
    for (let t = 0; t <= T + 1e-9; t += p.dt) {
      let P;
      if (t < p.dwell) P = p.Pmin;
      else if (t < p.dwell + tUp) P = p.Pmin + p.rate * (t - p.dwell);
      else if (t < 2 * p.dwell + tUp) P = p.Pmax;
      else P = Math.max(p.Pmin, p.Pmax - p.rate * (t - 2 * p.dwell - tUp));
      let s = solve(P, nOn);
      const req = reqAt(P);
      const dev = s.Qx - p.bias;
      let wantIn = nOn < p.nBanks && (nOn < req || s.V < p.Umin || (p.mode === 'Q' && dev < -p.band));
      let wantOut = nOn > req && (s.V > p.Umax || (p.mode === 'Q' && dev > p.band));
      if (p.mode === 'U') { wantIn = nOn < p.nBanks && (nOn < req || s.V < p.Umin); wantOut = nOn > req && s.V > p.Umax; }
      tIn = wantIn ? tIn + p.dt : 0;
      tOut = wantOut && !wantIn ? tOut + p.dt : 0;
      if (tIn >= p.tsw) { nOn++; ops++; tIn = 0; out.events.push({ t, P, dir: 'in', n: nOn, reason: nOn - 1 < req ? 'min-filter' : (s.V < p.Umin ? 'U-min' : 'Q-band') }); s = solve(P, nOn); }
      else if (tOut >= p.tsw) { nOn--; ops++; tOut = 0; out.events.push({ t, P, dir: 'out', n: nOn, reason: s.V > p.Umax ? 'U-max' : 'Q-band' }); s = solve(P, nOn); }
      maxDev = Math.max(maxDev, Math.abs(s.Qx - p.bias));
      vMax = Math.max(vMax, s.V); vMin = Math.min(vMin, s.V);
      out.t.push(t); out.P.push(P); out.Qconv.push(s.Qc); out.Qfilt.push(s.Qf); out.Qexch.push(s.Qx); out.Vac.push(s.V); out.n.push(nOn);
    }
    const curve = [];
    for (let i = 0; i <= 50; i++) { const P = i / 50; curve.push({ P, Q: convQ(P, p.angle, p.dx, 1) }); }
    return {
      params: p, series: out, curve,
      kpi: { ops, maxDev, vMax, vMin, dVstep: 100 * p.Qb / p.SCR, hunting: 2 * p.band < p.Qb, qAtRated: convQ(1, p.angle, p.dx, 1), totalFilters: p.nBanks * p.Qb }
    };
  }

  /* ======================================================================
     5. VSC — dq vector current control + DC-voltage control
     (X/ωb)·di_d/dt = v_cd − v_gd − R·i_d + X·i_q ;  (X/ωb)·di_q/dt = v_cq − v_gq − R·i_q − X·i_d
     2H·Vdc·dVdc/dt = P_dc,in − P_ac
  ====================================================================== */
  const VSC_DEFAULTS = {
    X: 0.15, R: 0.005, f: 50, fsw: 5000, BWi: 250, decouple: true, ffV: true,
    mode: 'current', H: 0.02, BWv: 15, zeta: 0.8, ffP: false, Imax: 1.1, mMax: 1.15,
    idStep: { t: 0.02, val: 0.8 }, iqStep: { t: 0.08, val: 0.4 },
    pdcStep: { t: 0.03, val: 0.8 }, gridDip: { on: false, t: 0.12, dur: 0.05, depth: 0.3 },
    T: 0.2, dt: 1e-5, nOut: 1500
  };

  function vscSim(userParams) {
    const p = mergeDeep(VSC_DEFAULTS, userParams);
    const wb = 2 * Math.PI * p.f;
    const Lpu = p.X / wb;
    const ac = 2 * Math.PI * p.BWi;
    const Kp = ac * Lpu, Ki = ac * p.R;
    const Tdel = 1.5 / p.fsw;
    const wv = 2 * Math.PI * p.BWv;
    const Kpv = 4 * p.H * p.zeta * wv, Kiv = 2 * p.H * wv * wv;
    const n = Math.round(p.T / p.dt), every = Math.max(1, Math.floor(n / p.nOut));
    let id = 0, iq = 0, xd = 0, xq = 0, vcd = 1, vcq = 0, Vdc = 1, xv = 0;
    const out = { t: [], id: [], iq: [], idRef: [], iqRef: [], vcd: [], vcq: [], vcm: [], vmax: [], Vdc: [], Pac: [], Pdc: [], vg: [] };
    let satTime = 0, cross = 0, vdcDev = 0;
    for (let s = 0; s <= n; s++) {
      const t = s * p.dt;
      const vg = p.gridDip.on && t >= p.gridDip.t && t < p.gridDip.t + p.gridDip.dur ? 1 - p.gridDip.depth : 1;
      const Pdc = p.mode === 'vdc' ? (t >= p.pdcStep.t ? p.pdcStep.val : 0) : null;
      let iqRef = t >= p.iqStep.t ? p.iqStep.val : 0;
      let idRef;
      if (p.mode === 'vdc') {
        const e = Vdc - 1;
        idRef = Kpv * e + xv + (p.ffP ? Pdc / Math.max(vg, 0.2) : 0);
        const lim = Math.sqrt(Math.max(0, p.Imax * p.Imax - iqRef * iqRef));
        if (Math.abs(idRef) < lim || Math.sign(e) !== Math.sign(idRef)) xv += Kiv * e * p.dt;
        idRef = clamp(idRef, -lim, lim);
      } else {
        idRef = t >= p.idStep.t ? p.idStep.val : 0;
      }
      // inner current PI (IMC tuned) with decoupling and grid-voltage feed-forward
      const ed = idRef - id, eq = iqRef - iq;
      let ud = Kp * ed + xd + (p.ffV ? vg : 0) - (p.decouple ? p.X * iq : 0);
      let uq = Kp * eq + xq + (p.decouple ? p.X * id : 0);
      const vmax = p.mMax * Vdc;
      const um = Math.hypot(ud, uq);
      let sat = false;
      if (um > vmax) { ud *= vmax / um; uq *= vmax / um; sat = true; satTime += p.dt; }
      if (!sat) { xd += Ki * ed * p.dt; xq += Ki * eq * p.dt; }
      // converter dead time (PWM + computation)
      vcd += (p.dt / Tdel) * (ud - vcd);
      vcq += (p.dt / Tdel) * (uq - vcq);
      // filter / transformer dynamics in dq
      const did = (vcd - vg - p.R * id + p.X * iq) / Lpu;
      const diq = (vcq - 0 - p.R * iq - p.X * id) / Lpu;
      id += did * p.dt; iq += diq * p.dt;
      const Pac = vg * id;
      if (p.mode === 'vdc') {
        Vdc += p.dt * (Pdc - Pac) / (2 * p.H * Math.max(Vdc, 0.2));
        vdcDev = Math.max(vdcDev, Math.abs(Vdc - 1));
      }
      if (p.mode === 'current' && t >= p.idStep.t && t < p.iqStep.t) cross = Math.max(cross, Math.abs(iq - iqRef));
      if (s % every === 0) {
        out.t.push(t); out.id.push(id); out.iq.push(iq); out.idRef.push(idRef); out.iqRef.push(iqRef);
        out.vcd.push(vcd); out.vcq.push(vcq); out.vcm.push(Math.hypot(vcd, vcq)); out.vmax.push(vmax);
        out.Vdc.push(Vdc); out.Pac.push(Pac); out.Pdc.push(Pdc === null ? Pac : Pdc); out.vg.push(vg);
      }
    }
    // id rise time after step (current mode) or Vdc settling (vdc mode)
    let rise = null, settle = null;
    if (p.mode === 'current') {
      const v = p.idStep.val; let t10 = null, t90 = null;
      for (let i = 0; i < out.t.length; i++) {
        if (out.t[i] < p.idStep.t) continue;
        if (t10 === null && out.id[i] >= 0.1 * v) t10 = out.t[i];
        if (t90 === null && out.id[i] >= 0.9 * v) { t90 = out.t[i]; break; }
      }
      rise = t10 !== null && t90 !== null ? t90 - t10 : null;
    } else {
      for (let i = out.t.length - 1; i >= 0; i--) { if (Math.abs(out.Vdc[i] - 1) > 0.01) { settle = out.t[i] - p.pdcStep.t; break; } }
    }
    return { params: p, series: out, gains: { Kp, Ki, Kpv, Kiv, Tdel }, kpi: { rise, settle, cross, vdcDev, satTime } };
  }

  return {
    D2R, R2D, vdo0Of, MODE_LABELS, POLE_DEFAULTS, BODE_DEFAULTS, RPC_DEFAULTS, VSC_DEFAULTS,
    simPoleControl, bodeCC, autoTuneCC, cfModel, convQ, rpcSim, vscSim, mergeDeep
  };
});
