"""Accessibility sweep with axe-core in light and dark mode, over the new and existing screens.

    cd frontend && npm ci            # provides node_modules/axe-core
    BASE_URL=http://localhost:5173 python e2e/a11y.py

Registers a throw-away user, creates one estimate per model, opens each screen (clicking the on-demand cards), and fails on any
axe violation (WCAG 2.x A/AA tags) or console error.
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173").rstrip("/")
AXE = (Path(__file__).resolve().parents[1] / "frontend" / "node_modules" / "axe-core" / "axe.min.js").read_text()
EMAIL, PASSWORD = f"a11y-{int(time.time())}@example.com", "A11y-pass-12345"
problems = []


def axe(page, label):
    page.evaluate(AXE)
    res = page.evaluate("axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa']}})")
    for v in res["violations"]:
        problems.append(f"{label}: {v['id']} ({v['impact']}) {v['help']} -> {[n['target'] for n in v['nodes'][:3]]}")
    print(f"{'ok ' if not res['violations'] else 'BAD'} {label}: {len(res['violations'])} violations")


def fill_form(scope):
    """Fill every empty number input at 40% of its allowed range and pick the first option of every empty select."""
    for inp in scope.locator("input[type=number]").all():
        if not inp.input_value():
            mn, mx = float(inp.get_attribute("min") or 0), float(inp.get_attribute("max") or 1)
            inp.fill(str(round(mn + (mx - mn) * 0.4)))
    for sel in scope.locator("select").all():
        if not sel.input_value():
            sel.select_option(index=1)


def both_themes(page, label):
    for theme in ("light", "dark"):
        page.evaluate(f"document.documentElement.dataset.theme = '{theme}'")
        page.mouse.move(0, 0); page.wait_for_timeout(500)   # let colour transitions settle
        axe(page, f"{label} [{theme}]")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
    page.on("console", lambda m: m.type == "error" and problems.append(f"console error: {m.text[:160]}"))
    page.on("pageerror", lambda e: problems.append(f"page error: {str(e)[:160]}"))

    # public pages
    page.goto(BASE + "/on-device"); page.get_by_role("button", name="Calculate on this device").wait_for()
    both_themes(page, "on-device (empty)")
    fill_form(page.locator("form"))
    page.get_by_role("button", name="Calculate on this device").click()
    page.get_by_test_id("device-score").wait_for()
    both_themes(page, "on-device (result)")
    page.goto(BASE + "/virtual-patient"); page.get_by_role("button", name="Next day").wait_for()
    page.wait_for_function("!document.querySelector('button[disabled]') || true")
    for _ in range(35):
        page.get_by_role("button", name="Next day").click()
    both_themes(page, "virtual-patient (day 35)")

    # signed-in pages
    page.goto(BASE + "/")
    page.get_by_role("tab", name="Create account").click()
    page.get_by_label("Name").fill("A11y Tester"); page.get_by_label("Email").fill(EMAIL); page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("checkbox").first.check(); page.locator("form button[type=submit]").click()
    page.get_by_text("Your Digital Twin").wait_for(timeout=15000)
    for cond, label in (("diabetes", "Diabetes"), ("heart_disease", "Heart disease"), ("diabetes_survey", "lifestyle")):
        page.goto(BASE + "/"); page.get_by_text("Your Digital Twin").wait_for()
        card = page.locator("article, section").filter(has_text=label).get_by_role("button", name="Get estimate").first
        card.click()
        form = page.locator("form[aria-label*='estimate inputs']")
        form.wait_for()
        fill_form(form)
        form.locator("button[type=submit]").click()
        page.wait_for_timeout(1500)
        page.goto(BASE + f"/risk/{cond}"); page.get_by_test_id("icon-array").wait_for(timeout=15000)
        page.get_by_role("button", name="Show both futures").click(); page.get_by_test_id("futures").wait_for(timeout=15000)
        btn = page.get_by_role("button", name="Find the smallest change")
        if btn.count():
            btn.click(); page.wait_for_timeout(1200)
        both_themes(page, f"risk/{cond}")
    page.goto(BASE + "/reliability"); page.get_by_text("How sure is each estimate").first.wait_for(timeout=15000)
    both_themes(page, "reliability")
    browser.close()

for pr in problems:
    print("PROBLEM", pr)
sys.exit(1 if problems else 0)
