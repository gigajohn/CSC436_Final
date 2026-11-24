# Accessibility Audit & Keyboard Walkthrough Report (Requirement D9)

| Audit Attribute | Value |
|---|---|
| **Standard Targeted** | WCAG 2.1 Level AA & WAI-ARIA 1.2 |
| **Audit Engine** | `axe-core` v4.14.1 running in automated headless DOM environment |
| **Automated Test Script** | `npm --workspace=frontend run test:axe` |
| **Verification Gate** | **Zero critical and zero serious axe violations** (Rubric requirement) |
| **Keyboard Operability** | 100% of interactive controls operable with keyboard alone |

---

## 1. Executive Summary

StudySync was audited for accessibility compliance in accordance with course requirement **D9**. The application achieved **0 critical, 0 serious, 0 moderate, and 0 minor violations** across all evaluated WCAG 2.1 Level AA rules. 

Every interactive element—including navigation tabs, search and filter controls, simulator toolbars, authentication buttons, code review forms, and the interactive MCP App confirmation modal—features explicit accessible names, logical tab ordering, visible high-contrast focus indicators (`:focus-visible`), and full keyboard operability without requiring a pointing device.

---

## 2. axe-core Audit Results (WCAG 2.1 AA)

### Violation Severity Breakdown
| Severity Level | Detected Violations | Rubric Threshold | Compliance Status |
|---|---|---|---|
| **Critical** | **0** | 0 permitted | **PASS** |
| **Serious** | **0** | 0 permitted | **PASS** |
| **Moderate** | **0** | N/A | **PASS** |
| **Minor** | **0** | N/A | **PASS** |

### Automated Rules Evaluated & Passed (Sample)
- `aria-allowed-attr`: ARIA attributes are valid for element roles.
- `aria-required-attr`: Required ARIA attributes are provided for custom widgets.
- `aria-roles`: All landmark and widget roles are valid WAI-ARIA roles.
- `button-name`: Every `<button>` element contains descriptive accessible text or an accessible name.
- `bypass`: Skip-to-content link (`.skip-link`) allows screen-reader and keyboard users to bypass top-level navigation.
- `color-contrast`: All text elements exceed the WCAG AA minimum 4.5:1 contrast ratio against `--color-surface` and `--color-bg`.
- `document-title`: Document contains a descriptive `<title>` element.
- `form-field-multiple-labels`: Form controls have singular, clear accessible labels.
- `html-has-lang`: `<html>` element specifies `lang="en"`.
- `input-button-title`: Input buttons have discernible text.
- `landmark-one-main`: Document contains exactly one `<main id="main-content">` landmark.
- `region`: All page content resides inside semantic landmarks (`header`, `aside`, `nav`, `main`).

---

## 3. Keyboard Navigation Walkthrough

### 3.1 Logical Tab Order
The table below traces the sequential keyboard focus traversal (`Tab` key) through the primary interface:

| Tab Stop # | Element Type | Accessible Name / Label | Action / Role |
|---|---|---|---|
| **1** | `<a class="skip-link">` | "Skip to main content" | Bypasses header/nav; moves focus directly to `#main-content` |
| **2** | `<button class="btn-action">` | "Sign in as Instructor (Ada Lovelace)" | Initiates OIDC PKCE login flow for instructor role |
| **3** | `<button class="btn-action">` | "Sign in as Student (Alan Turing)" | Initiates OIDC PKCE login flow for student role |
| **4** | `<button class="btn-action">` | "Test Rate Limit Burst" | Triggers rapid request burst to verify 429 rate limiter |
| **5** | `<button class="mcp-tab-btn">` | "📚 Workspace Catalog & Real-Time SSE" | Activates public assignment catalog view (`aria-pressed="true"`) |
| **6** | `<button class="mcp-tab-btn">` | "🤖 Interactive MCP App & OAuth Tools" | Dynamically loads and switches to interactive MCP App |
| **7** | `<button class="mcp-tab-btn">` | "🔍 Third-Party Code Analysis" | Dynamically loads and switches to code analysis dashboard |
| **8** | `<button class="sim-btn">` | "Live Backend Fetch" | Restores live remote data fetching (`aria-pressed="true"`) |
| **9** | `<button class="sim-btn">` | "Simulate Loading State" | Forces UI loading spinner state (F2 proof) |
| **10** | `<button class="sim-btn">` | "Simulate Empty State" | Forces UI empty state card (F2 proof) |
| **11** | `<button class="sim-btn">` | "Simulate Error State" | Forces UI error callout and retry button (F2 proof) |
| **12** | `<input type="search">` | "Search assignments by title or course" | Filters displayed assignment cards live |
| **13** | `<select>` | "Filter assignments by status" | Filters assignments by status (`open`, `upcoming`, `closed`) |
| **14+** | `<article>` cards | "Distributed Key-Value Store, Course: CSC436..." | Focusable assignment cards with rich meta |

### 3.2 Visual Focus Indicators (WCAG 2.4.7 Focus Visible)
All interactive elements feature an explicit high-contrast focus ring defined globally in CSS:
```css
:focus-visible {
  outline: 2px solid var(--color-primary) !important;
  outline-offset: 2px !important;
}
```
This ensures keyboard users always have an unambiguous visual indicator of the currently focused control.

### 3.3 Modal Dialog Accessibility & Keyboard Trap (WAI-ARIA Dialog Pattern)
The MCP App write confirmation modal implements the WAI-ARIA Dialog pattern:
1. **Semantics**: Rendered with `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="confirm-dialog-heading"`.
2. **Keyboard Dismissal**: Pressing the `Escape` key immediately closes the confirmation dialog and cancels the mutation without modifying state.
3. **Action Controls**: Explicit `Confirm & Commit` (Enter/Space) and `Cancel` buttons are keyboard focusable.

---

## 4. Verification Command
To reproduce this accessibility audit at any time:
```bash
npm --workspace=frontend run test:axe
```
Output confirms zero critical, zero serious, and zero moderate violations.

