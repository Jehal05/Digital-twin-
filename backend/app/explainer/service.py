"""Grounded explanations of a stored estimate.

The default explainer is deterministic: every sentence is built from fields already stored with the estimate (score, drivers,
trust, limitations), so it cannot invent a number. An optional language-model provider may answer free-text questions, but only
from a small facts payload, only with the user's consent, and its reply is rejected if it contains a number that is not in the
facts. Urgent-symptom questions are never answered by a model.
"""
from __future__ import annotations

import re
from typing import Protocol

DISCLAIMER = "Experimental model estimate, not a diagnosis. This explains the model, not your health."
EMERGENCY = re.compile(r"chest pain|can'?t breathe|cannot breathe|short(ness)? of breath|faint|passed out|stroke|suicid|kill myself|"
                       r"overdose|heart attack|severe pain|blood in", re.I)
EMERGENCY_REPLY = ("I can't help with symptoms. If you have chest pain, trouble breathing, fainting, or you're thinking of harming "
                   "yourself, contact your local emergency number or go to the nearest emergency department now.")
TOPICS = ("summary", "why", "uncertainty", "what_can_change", "about_model")
BAND = {"low": "lower", "moderate": "moderate", "high": "higher"}


class Provider(Protocol):
    def complete(self, system: str, facts: dict, question: str) -> str: ...


def facts_for(pred: dict) -> dict:
    """The only data a provider ever sees: no name, email, dates of birth or free text from the user."""
    t, e = pred.get("trust") or {}, pred.get("explanation") or {}
    return {
        "condition": pred["condition"], "score_percent": round(pred["score"] * 100, 1), "band": BAND[pred["risk_band"]],
        "inputs": pred["input_snapshot"], "model_range_percent": ([round(t["uncertainty_range"]["low"] * 100), round(t["uncertainty_range"]["high"] * 100)]
                                                                  if t.get("uncertainty_range") else None),
        "drivers": [{"label": d["label"], "value": d["value"], "unit": d["unit"], "effect_points": round(d["effect"] * 100, 1),
                     "direction": d["direction"]} for d in e.get("top_drivers", [])],
        "average_percent": round(e["base_value"] * 100, 1) if "base_value" in e else None,
        "model_agreement": (t.get("model_agreement") or {}).get("level"), "editable_inputs": pred.get("editable_inputs", []),
        "limitations": pred.get("limitations") or [],
    }


def template_answer(topic: str, f: dict) -> str:
    name = "diabetes" if f["condition"] == "diabetes" else "heart disease"
    if topic == "summary":
        rng = f" The model's own range is {f['model_range_percent'][0]}% to {f['model_range_percent'][1]}%." if f["model_range_percent"] else ""
        return (f"For {name}, the model's estimate for these inputs is {f['score_percent']}%, in the {f['band']} band.{rng} "
                f"This is a statistical estimate from a small research dataset, not a measurement of you.")
    if topic == "why":
        if not f["drivers"]:
            return "No per-input breakdown is stored for this estimate."
        avg = f" Compared with the study average of {f['average_percent']}%," if f["average_percent"] is not None else ""
        parts = [f"{d['label']} ({d['value']} {d['unit']}) {'raises' if d['direction'] == 'raises' else 'lowers'} it by {abs(d['effect_points'])} points"
                 for d in f["drivers"][:3]]
        return (f"{avg} the biggest influences were: " + "; ".join(parts) + ". These describe how the model behaves; they do not show "
                "what causes disease, and 'lowers' only means below the dataset average.").strip()
    if topic == "uncertainty":
        agree = {"high": "closely", "medium": "reasonably", "low": "only loosely"}.get(f["model_agreement"] or "", "")
        rng = f"The model's variability range is {f['model_range_percent'][0]}% to {f['model_range_percent'][1]}%. " if f["model_range_percent"] else ""
        return (rng + (f"The two models agreed {agree}. " if agree else "") +
                "This range is model variability, not a confidence interval. " + " ".join(f["limitations"][:2]))
    if topic == "what_can_change":
        ed = ", ".join(f["editable_inputs"]) or "none of the inputs"
        return (f"Only some inputs can change over time: {ed}. The What-If Simulator reruns the model with different values so you can see "
                "how the estimate responds. A change in the model's estimate does not prove a change in real health; talk to a clinician "
                "about any decision.")
    if topic == "about_model":
        return ("This is a simple statistical model trained on a public research dataset. It was not built or tested for clinical use. "
                + " ".join(f["limitations"][:3]))
    raise ValueError("unknown topic")


SYSTEM = ("You explain one stored model estimate in plain language. Use ONLY the JSON facts. Never diagnose, never recommend treatment "
          "or medication, never add numbers that are not in the facts, and say it is an experimental estimate. Keep it under 120 words.")
NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _allowed_numbers(f: dict) -> set[float]:
    out: set[float] = set()

    def walk(v):
        if isinstance(v, bool):
            return
        if isinstance(v, (int, float)):
            out.add(round(float(v), 1))
        elif isinstance(v, str):
            out.update(round(float(n), 1) for n in NUMBER.findall(v))
        elif isinstance(v, dict):
            [walk(x) for x in v.values()]
        elif isinstance(v, (list, tuple)):
            [walk(x) for x in v]
    walk(f)
    out.update(round(abs(x), 1) for x in list(out))
    return out


def grounded(text: str, f: dict) -> bool:
    ok = _allowed_numbers(f)
    return all(round(float(n), 1) in ok for n in NUMBER.findall(text))


def answer(pred: dict, topic: str | None, question: str | None, provider: Provider | None, consent_ai: bool) -> dict:
    f = facts_for(pred)
    if question and EMERGENCY.search(question):
        return {"answer": EMERGENCY_REPLY, "source": "safety", "refused": True, "topic": None, "disclaimer": DISCLAIMER}
    if question and provider and consent_ai:
        try:
            text = provider.complete(SYSTEM, f, question)
        except Exception:
            text = ""
        if text and grounded(text, f):
            return {"answer": text.strip(), "source": "llm", "refused": False, "topic": None, "disclaimer": DISCLAIMER}
        fallback = template_answer("summary", f)
        return {"answer": "I couldn't produce a reliable answer to that, so here is the standard summary instead. " + fallback,
                "source": "template", "refused": False, "topic": "summary", "disclaimer": DISCLAIMER}
    if question and not topic:
        why = ("Free-text questions need the AI explainer, which is " + ("not configured on this server." if provider is None else
               "switched off in your privacy settings."))
        return {"answer": why + " You can still ask about: " + ", ".join(TOPICS) + ".", "source": "template", "refused": True,
                "topic": None, "disclaimer": DISCLAIMER}
    topic = topic or "summary"
    return {"answer": template_answer(topic, f), "source": "template", "refused": False, "topic": topic, "disclaimer": DISCLAIMER}
