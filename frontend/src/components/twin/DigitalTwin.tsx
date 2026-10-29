import { useReducedMotion } from "framer-motion";
import { useRef, useState, type PointerEvent } from "react";
import type { Condition, Prediction, RiskBand } from "../../api/types";
import { BAND_LABEL, pct, points } from "../../lib/format";
import { ContentTag, ExperimentalNote } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";

const GLOW: Record<RiskBand, string> = { low: "#22b573", moderate: "#f2a60c", high: "#e5534b" };
const NAME: Record<Condition, string> = { diabetes: "Diabetes", heart_disease: "Heart disease" };
const SYSTEM: Record<Condition, string> = { diabetes: "Metabolic system", heart_disease: "Cardiovascular system" };
const POS: Record<Condition, { x: number; y: number; badgeX: number; anchor: "start" | "end" }> = {
  heart_disease: { x: 148, y: 160, badgeX: 214, anchor: "start" },
  diabetes: { x: 118, y: 224, badgeX: 10, anchor: "end" },
};
const MIN = 1, MAX = 2.4, STEP = 0.4;

function Organ({ c, p, available, reduce, onHover, onSelect }: {
  c: Condition; p: Prediction | null; available: boolean; reduce: boolean;
  onHover(c: Condition | null): void; onSelect(c: Condition): void;
}) {
  const { x, y, badgeX, anchor } = POS[c];
  const has = available && p !== null;
  const color = has ? GLOW[p!.risk_band] : "#8a97b3";
  const strength = has ? 0.28 + 0.62 * p!.score : 0.12;
  const label = has ? `${NAME[c]} ${pct(p!.score)}` : `${NAME[c]} ${available ? "no estimate yet" : "model not available"}`;
  const bx = anchor === "start" ? badgeX : badgeX + 76;
  return (
    <g tabIndex={0} role="button" aria-label={`${label}. ${SYSTEM[c]}. Press Enter for details.`} style={{ cursor: "pointer" }}
      onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(c)} onBlur={() => onHover(null)}
      onClick={() => onSelect(c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c); } }}>
      <circle cx={x} cy={y} r={36} fill={`url(#glow-${c})`} opacity={strength} className={has && !reduce ? "glow-pulse" : ""}
        style={{ ["--glow-min" as string]: strength * 0.7, ["--glow-max" as string]: Math.min(1, strength * 1.15) }} />
      {c === "heart_disease" ? (
        <path d="M0 11 C-20 -4 -13 -20 0 -9 C13 -20 20 -4 0 11Z" transform={`translate(${x} ${y})`} fill={color} fillOpacity={has ? 0.9 : 0.35}
          stroke="#fff" strokeWidth="1.5" strokeDasharray={has ? undefined : "3 3"} />
      ) : (
        <ellipse cx={x} cy={y} rx={28} ry={9} transform={`rotate(-10 ${x} ${y})`} fill={color} fillOpacity={has ? 0.9 : 0.35}
          stroke="#fff" strokeWidth="1.5" strokeDasharray={has ? undefined : "3 3"} />
      )}
      <line x1={x} y1={y} x2={anchor === "start" ? badgeX : badgeX + 76} y2={y - 4} stroke="#10203f" strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 3" />
      <rect x={anchor === "start" ? badgeX : badgeX} y={y - 24} width="76" height="40" rx="12" fill="#fff" fillOpacity=".92" stroke={color} strokeWidth="1.5" />
      <text x={bx - (anchor === "start" ? 0 : 76) + 38} y={y - 7} textAnchor="middle" fontSize="9.5" fill="#44536f" fontWeight="600">{NAME[c]}</text>
      <text x={bx - (anchor === "start" ? 0 : 76) + 38} y={y + 9} textAnchor="middle" fontSize="15" fill="#10203f" fontWeight="700" className="num">{has ? pct(p!.score) : "—"}</text>
    </g>
  );
}

export function DigitalTwin({ predictions, available, onSelect, onRun }: {
  predictions: Record<Condition, Prediction | null>; available: Condition[]; onSelect(c: Condition): void; onRun(): void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [scale, setScale] = useState(MIN);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<Condition | null>(null);
  const [full, setFull] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const zoom = (d: number) => setScale((s) => { const n = Math.min(MAX, Math.max(MIN, +(s + d).toFixed(2))); if (n === MIN) setPan({ x: 0, y: 0 }); return n; });
  const down = (e: PointerEvent) => { if (scale > MIN) { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; (e.currentTarget as Element).setPointerCapture(e.pointerId); } };
  const move = (e: PointerEvent) => { const d = drag.current; if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); };
  const up = () => { drag.current = null; };
  async function toggleFull() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); setFull(false); }
      else if (box.current?.requestFullscreen) { await box.current.requestFullscreen(); setFull(true); }
    } catch { /* fullscreen not permitted here */ }
  }

  const summary = (["diabetes", "heart_disease"] as Condition[]).map((c) => {
    const p = predictions[c];
    return !available.includes(c) ? `${NAME[c]}: model not available` : p ? `${NAME[c]}: ${pct(p.score)}, ${BAND_LABEL[p.risk_band]}` : `${NAME[c]}: no estimate yet`;
  }).join(". ");
  const tip = hover ? predictions[hover] : null;
  const btn = "grid h-9 w-9 place-items-center rounded-full bg-white/85 text-lg font-semibold text-ink shadow hover:bg-white disabled:opacity-40";

  return (
    <Glass className="flex flex-col self-start p-5" aria-labelledby="twin-title">
      <CardTitle aside={<ContentTag kind="ai_estimate" />}><span id="twin-title">Your Digital Twin</span></CardTitle>
      <p className="mb-3 text-sm text-muted">A schematic of the model estimates for your current profile. It updates when you run a new estimate.</p>

      <div ref={box} className={`relative overflow-hidden rounded-[20px] bg-gradient-to-b from-white/60 to-[#cfdcf5]/70 ${full ? "h-screen" : "h-[460px]"}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: scale > MIN ? "none" : "auto" }}>
        <div className="grid h-full place-items-center" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transition: reduce || drag.current ? "none" : "transform .25s ease", cursor: scale > MIN ? "grab" : "default" }}>
          <svg viewBox="0 0 300 560" className="h-full max-h-[540px]" role="group" aria-label={`Schematic body with model estimates. ${summary}`}>
            <defs>
              <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#b9cdf0" stopOpacity=".75" /></linearGradient>
              {(["diabetes", "heart_disease"] as Condition[]).map((c) => {
                const col = predictions[c] && available.includes(c) ? GLOW[predictions[c]!.risk_band] : "#8a97b3";
                return <radialGradient key={c} id={`glow-${c}`}><stop offset="0" stopColor={col} stopOpacity="1" /><stop offset="1" stopColor={col} stopOpacity="0" /></radialGradient>;
              })}
            </defs>
            <g fill="url(#body)" stroke="#fff" strokeWidth="2" aria-hidden>
              <ellipse cx="150" cy="52" rx="27" ry="32" />
              <rect x="138" y="80" width="24" height="24" rx="8" />
              <path d="M88 112 Q150 94 212 112 Q228 120 228 148 L222 262 Q218 294 202 310 L98 310 Q82 294 78 262 L72 148 Q72 120 88 112Z" />
              <rect x="44" y="124" width="30" height="196" rx="15" transform="rotate(5 59 124)" />
              <rect x="226" y="124" width="30" height="196" rx="15" transform="rotate(-5 241 124)" />
              <rect x="100" y="304" width="48" height="236" rx="24" />
              <rect x="152" y="304" width="48" height="236" rx="24" />
            </g>
            {(["heart_disease", "diabetes"] as Condition[]).map((c) => (
              <Organ key={c} c={c} p={predictions[c]} available={available.includes(c)} reduce={reduce} onHover={setHover} onSelect={onSelect} />
            ))}
          </svg>
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button className={btn} onClick={() => zoom(STEP)} disabled={scale >= MAX} aria-label="Zoom in">+</button>
          <button className={btn} onClick={() => zoom(-STEP)} disabled={scale <= MIN} aria-label="Zoom out">{"−"}</button>
          <button className={btn} onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? "⤢" : "⛶"}</button>
        </div>

        {tip && hover && (
          <div role="tooltip" className="pointer-events-none absolute bottom-3 left-3 right-16 rounded-2xl bg-white/95 p-3 text-sm shadow-lg">
            <p className="font-semibold">{NAME[hover]} <span className="num">{pct(tip.score, 1)}</span> <span className="font-normal text-muted">({BAND_LABEL[tip.risk_band]})</span></p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {tip.explanation?.top_drivers.slice(0, 3).map((d) => <li key={d.feature}>{d.label}: {d.value}{d.unit ? ` ${d.unit}` : ""} ({d.direction}, {points(d.effect)})</li>)}
            </ul>
          </div>
        )}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 text-xs" aria-label="Legend">
        {(["diabetes", "heart_disease"] as Condition[]).map((c) => (
          <li key={c} className="panel-dim flex items-center gap-2 p-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: predictions[c] && available.includes(c) ? GLOW[predictions[c]!.risk_band] : "#8a97b3" }} />
            <span><span className="font-semibold">{SYSTEM[c]}</span><br /><span className="text-muted">{NAME[c]} model{!available.includes(c) ? " (not trained yet)" : ""}</span></span>
          </li>
        ))}
      </ul>
      <p className="sr-only" data-testid="twin-summary">{summary}</p>
      <ExperimentalNote className="mt-3" />
      <p className="text-xs text-muted">Organ positions are symbolic. The glow strength follows the model's estimate; it is not an image of your body.</p>
      {!predictions.diabetes && !predictions.heart_disease && <button onClick={onRun} className="mt-3 self-start text-sm font-semibold text-brand underline">Get your first estimate</button>}
    </Glass>
  );
}
