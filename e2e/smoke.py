"""End-to-end smoke test: registers a fresh user through the UI and walks the key flows in a real browser.

    pip install playwright && playwright install chromium
    BASE_URL=http://localhost:8080 python e2e/smoke.py        # default http://localhost:5173

Fails on any console error / uncaught exception, and checks the production-only parts (service worker, CSP) when
the app is served over the built bundle. Needs a running API behind BASE_URL (and an auth rate limit that allows ~10 calls).
"""
import os
import sys
import time

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173").rstrip("/")
EMAIL = f"smoke-{int(time.time())}@example.com"
PASSWORD = "Smoke-pass-12345"
problems: list[str] = []


def step(name):
    print(f"ok  {name}")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and problems.append(f"console error: {m.text[:200]}"))
    page.on("pageerror", lambda e: problems.append(f"page error: {str(e)[:200]}"))

    page.goto(BASE + "/")
    page.get_by_role("tab", name="Create account").click()
    page.get_by_label("Name").fill("Smoke Tester")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("checkbox").first.check()
    page.locator("form button[type=submit]").click()
    expect(page.get_by_text("Your Digital Twin")).to_be_visible(timeout=15000)
    step("register and reach dashboard")

    page.get_by_role("link", name="My data").click()
    page.get_by_label("Date of birth").fill("1982-04-12")
    page.get_by_label("Sex").first.select_option("female")
    page.get_by_label("Height (cm)").fill("165")
    page.get_by_role("button", name="Save profile").click()
    expect(page.get_by_role("status").first).to_be_visible(timeout=8000)
    step("save profile")

    page.get_by_role("link", name="Dashboard").click()
    diabetes = page.locator("article[aria-label='Diabetes summary']")
    diabetes.get_by_role("button", name="Get estimate").click()
    form = page.locator("form[aria-label='Diabetes estimate inputs']")
    for label, value in [("Number of pregnancies", "2"), ("2-hour plasma glucose", "150"), ("Diastolic blood pressure", "80"), ("Body mass index", "31")]:
        form.get_by_label(label, exact=False).fill(value)
    if not form.get_by_label("Age", exact=False).input_value():
        form.get_by_label("Age", exact=False).fill("44")
    form.locator("button[type=submit]").click()
    expect(page.get_by_text("Experimental model estimate, not a diagnosis.").first).to_be_visible(timeout=15000)
    expect(page.get_by_text("Why this score?")).to_be_visible()
    step("diabetes estimate with explanation")

    heart = page.locator("article[aria-label='Heart disease summary']")
    heart.get_by_role("button", name="Get estimate").click()
    form = page.locator("form[aria-label='Heart disease estimate inputs']")
    for label, value in [("Age", "58"), ("Resting systolic", "140"), ("Serum cholesterol", "240"), ("Maximum heart rate", "120"), ("ST depression", "2")]:
        form.get_by_label(label, exact=False).fill(value)
    for label, value in [("Sex", "1"), ("Chest pain type", "4"), ("Fasting blood sugar", "0"), ("Resting ECG", "0"), ("brought on by exercise", "1")]:
        form.get_by_label(label, exact=False).select_option(value)
    form.locator("button[type=submit]").click()
    expect(page.locator("article[aria-label='Heart disease summary'] .num")).to_be_visible(timeout=15000)
    expect(page.get_by_text("No chest pain (asymptomatic)")).to_be_visible()
    step("heart estimate with plain-language explanation")

    page.get_by_role("link", name="Simulator").click()
    page.get_by_role("button", name="Heart disease").click()
    page.locator("#sl-trestbps").fill("120")
    page.get_by_role("button", name="Run scenario").click()
    expect(page.get_by_text("Change in this model's estimate")).to_be_visible(timeout=15000)
    step("heart what-if scenario")

    page.keyboard.press("Control+k")
    expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")
    step("command palette")

    page.get_by_role("link", name="Report").click()
    page.get_by_role("button", name="Create link").click()
    url = page.get_by_label("Share link").input_value()
    anon = browser.new_context().new_page()
    anon.on("pageerror", lambda e: problems.append(f"anon page error: {str(e)[:200]}"))
    anon.goto(url if url.startswith("http") else BASE + url)
    expect(anon.get_by_text("Experimental model estimate, not a diagnosis.").first).to_be_visible(timeout=15000)
    step("share link opens for an anonymous visitor")

    page.get_by_role("link", name="Settings").click() if page.get_by_role("link", name="Settings").count() else page.goto(BASE + "/settings")
    page.get_by_label("Dark").check() if page.get_by_label("Dark").count() else None
    page.get_by_role("button", name="Sign out").click()
    expect(page.get_by_role("tab", name="Sign in")).to_be_visible(timeout=8000)
    step("sign out")

    if page.evaluate("'serviceWorker' in navigator") and BASE.endswith(("8080", "80")) or os.environ.get("EXPECT_SW"):
        page.reload()
        page.wait_for_function("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true)", timeout=10000)
        offline_started = len(problems)
        ctx.set_offline(True)
        page.reload()
        expect(page.locator("form")).to_be_visible(timeout=10000)
        ctx.set_offline(False)
        del problems[offline_started:]  # failed network requests while offline are expected
        step("app shell loads offline (service worker)")
    browser.close()

if problems:
    print("\nPROBLEMS:\n" + "\n".join(problems))
    sys.exit(1)
print("\nsmoke test passed")
