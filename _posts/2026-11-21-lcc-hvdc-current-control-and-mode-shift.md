---
title: "Inside an LCC-HVDC pole: current control, CEA and the mode shift"
date: 2026-11-21 20:00:00 +0530
topic: HVDC
description: "How the rectifier current controller, the inverter extinction-angle control and the current margin share the job of running a line-commutated HVDC link — with a live simulator you can push into mode shift yourself."
standard: CIGRE HVDC benchmark · IEC 60919-1
tags: [LCC-HVDC, current control, VDCOL, control systems]
---

A line-commutated (LCC) HVDC pole is controlled by two converters that never talk fast enough to coordinate every millisecond. They still manage to share the work cleanly because of one simple idea: **each terminal owns a different variable, and a small current margin decides who is in charge.** This note walks through that idea with the equations and a simulator you can drive yourself.

## Two converters, two equations

With a firing angle $$\alpha$$ at the rectifier and an extinction angle $$\gamma$$ at the inverter, the average DC voltages are

$$
V_{dr} = V_{do,r}\cos\alpha - R_{c}\,I_d, \qquad V_{di} = V_{do,i}\cos\gamma - R_{c}\,I_d
$$

where $$R_c = \tfrac{3}{\pi}X_c$$ per six-pulse bridge represents the voltage lost during commutation overlap. The current is set by the difference between the two voltages across the DC circuit:

$$
L\,\frac{dI_d}{dt} = V_{dr} - V_{di} - R_d\,I_d
$$

Because $$R_d$$ is small, a 1 % change in either voltage moves the current by tens of percent. The current therefore has to be **controlled**, not merely allowed to settle.

## Who controls what

- **Rectifier — constant current (CC).** A PI controller adjusts $$\alpha$$ so that $$I_d$$ follows the current order $$I_{ord}$$ derived from the power order ($$I_{ord} = P_{ord}/V_d$$).
- **Inverter — constant extinction angle (CEA).** The inverter fires as late as safely possible, holding $$\gamma$$ at about 15–18°. This keeps the DC voltage high (low losses, low reactive power) while leaving enough time for the outgoing valve to recover.
- **Inverter — current control with margin.** The inverter also has a current controller, but its reference is $$I_{ord} - \Delta I$$ with $$\Delta I \approx 0.1$$ pu. In normal operation the measured current is above that reference, so this controller sits saturated and inactive.

The current margin is the trick: the two current controllers can never fight, because their set-points differ by $$\Delta I$$.

## The mode shift

Now let the rectifier AC voltage drop by 20 %. The rectifier reduces $$\alpha$$ to keep the current up, but soon reaches $$\alpha_{min}$$ (≈5°) — it has no voltage left. The current falls, and once it reaches $$I_{ord} - \Delta I$$ the inverter's current controller wakes up and *increases* $$\gamma$$, lowering $$V_{di}$$ until the current is held at the reduced value. The rectifier is now the voltage-setting terminal and the inverter regulates current. When the AC voltage recovers, everything shifts back automatically.

Try it below: the **amber bands** mark the time spent in mode shift. Scrub the time slider to see which controller is active in the block diagram.

{% include sim.html module="pole" params="rampOn=0&rdOn=1" caption="Rectifier AC voltage dip of 20 % for 200 ms → mode shift. Try deeper dips, or switch VDCOL off." %}

Things worth noticing in the simulation:

1. **Power control asks for more current** while the voltage is low ($$I_{ord} = P_{ord}/V_d$$). VDCOL caps that request, which is why the current order flattens during deep dips.
2. **γ rises during the mode shift** — the inverter is "spending" margin to regulate current. That also increases its reactive power demand, something the reactive-power controller has to absorb.
3. **Recovery is fast** because no telecommunication is needed: each terminal simply sees the current return above the margin.

## Tuning the rectifier current loop

Linearising the rectifier equation around the operating point gives the plant seen by the PI controller:

$$
G(s) = \frac{V_{do}\sin\alpha_0\; e^{-sT_d}}{(R_{eq} + sL)(1+sT_m)}
$$

Two details matter in practice. First, with the inverter on CEA, $$V_{di}$$ falls with current, cancelling the rectifier's commutation resistance, so $$R_{eq} \approx R_d$$ — the loop behaves almost like a pure integrator. Second, the plant gain is proportional to $$\sin\alpha_0$$: a converter running at a small firing angle has a much weaker current loop than the same converter at 20°. That is why manufacturers use gain scheduling or non-linear gains in the CC amplifier.

Use the tuning module to see the phase margin collapse as you raise $$K_p$$, then press **Auto-tune** and **Use gains in Pole Control** to verify the design in the time domain.

{% include sim.html module="tune" caption="Open-loop Bode plot of the rectifier current loop. Target ≈ 30 Hz bandwidth with 60° phase margin." %}

## Reproduce it in Python

Everything in the lab is plain, open-source JavaScript (`assets/js/hvdc-models.js`), and the **Python Workbench** tab runs the same equations in NumPy inside your browser via Pyodide. Copy the script into Jupyter to extend it with pandapower, PyPSA or PyPowSyBl for system-level studies.

## Key takeaways

- The rectifier controls current, the inverter controls extinction angle; the **current margin** guarantees only one current controller is active.
- A weak rectifier AC voltage produces a **mode shift**: the inverter takes over current control at $$I_{ord} - \Delta I$$.
- **VDCOL** limits the current order at low DC voltage and is essential for recovery after AC and DC faults.
- Current-loop tuning depends on the operating point through $$\sin\alpha_0$$ and is ultimately limited by the converter dead time.

*Models are average-value and educational. Validate designs with EMT tools (PSCAD/EMTDC, EMTP, OpenModelica, ParaEMT) and manufacturer data.*
