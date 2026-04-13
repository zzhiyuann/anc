# ANC Dashboard — Design Specification

> A single-CEO command surface for an AI company. This document is the source of truth for the visual + interaction redesign of `apps/web`. It supersedes any Linear-inspired styling currently in `globals.css`.

**Status:** v1.0 — implementation-ready
**Audience:** the next agent that touches `apps/web/src/**`
**Last revised:** 2026-04-13

---

## 0. Table of contents

1. Design philosophy
2. The metaphor: *the bridge*
3. Color system (oklch, light + dark)
4. Typography
5. Spacing, density, rhythm
6. Motion language
7. Layout system & primary metaphor
8. Core surfaces (wireframes + interaction)
9. Component library
10. Unique-to-ANC surfaces
11. Accessibility & keyboard
12. Implementation notes (tokens, libs, file map)
13. Non-goals
14. Open questions

---

## 1. Design philosophy

ANC is the **bridge of a starship operated by a crew of one**. The CEO sits at a calm, warm console while a small AI crew works in the engine rooms below. The interface should feel:

- **Inhabited, not transactional.** Agents are characters with state, not rows in a table.
- **Calm under load.** Even with 6 agents running in parallel, the surface never feels like a Bloomberg terminal. It breathes.
- **Editorially confident.** Generous whitespace, real typographic hierarchy, opinionated color. Never a sea of identical 12px gray text.
- **Warm, slightly analog.** A hint of paper, brass, and amber light. The opposite of a "developer dark dashboard."
- **Keyboard-native but mouse-graceful.** Every primary action has a key. Every panel is also a delight to click through.

What it deliberately is **not**:

- **Not Linear.** No purple-on-near-black, no 3-pane master/detail/properties cliché, no Inter-13-px-everywhere, no tiny pill chips, no left-rail icon strip with 28-px square hits. We even avoid Linear's signature `border-l-2` "selected row" trick.
- **Not Jira / Asana.** No avatar-spam, no card grids of identical tiles, no "swimlane" everything.
- **Not the Vercel / Resend dev dashboard.** No giant monospace numerals on a black void with one violet button.
- **Not a chat app.** Despite the conversational nature, the home is not a chat window — the conversation is one panel inside a larger spatial console.

---

## 2. The metaphor — *The Bridge*

The product is a single command surface ("the bridge") with **specialized stations** for the CEO. The agents work "below decks" in their own terminals; the CEO surfaces them through **viewports** rather than browsing them in a list.

Three structural ideas drive every layout decision:

1. **The Roster Rail** (left) — always-visible *crew*, not navigation. Agents are presented as portraits with live status. Navigation lives *under* the roster, not above it. This inverts the typical sidebar.
2. **The Stage** (center) — the active surface. Editorial, single-column-ish, with deliberate whitespace. Tasks, projects, inbox all render here. The stage is *one thing at a time*, deeply.
3. **The Telemetry Strip** (right, collapsible) — live counters, cost meter, today's heartbeat. Only opens when invoked or when something demands attention. Default state: collapsed to a 48px brass rail.

There is **no master/detail/properties triple-pane**. There is *one focused stage* and *two ambient rails*. This is the single biggest visual departure from Linear and from every dev dashboard.

---

## 3. Color system

The palette is built around **warm graphite** (the chrome) and a single distinctive accent — **brass amber** — with a quiet sage for "running / healthy" states. We avoid blue-violet entirely; that's Linear's territory and the entire dev-dashboard cliché.

### 3.1 Light theme — "Daylight Bridge"

| Token | oklch | Role |
|---|---|---|
| `--bg-canvas` | `oklch(0.985 0.004 75)` | App background. Warm bone, not white. |
| `--bg-stage` | `oklch(0.995 0.003 75)` | The center stage — slightly lighter than canvas to lift it. |
| `--bg-rail` | `oklch(0.965 0.006 75)` | Left + right rails. |
| `--bg-sunken` | `oklch(0.945 0.008 70)` | Inset surfaces (terminals, code blocks). |
| `--ink-primary` | `oklch(0.22 0.015 60)` | Body text. Warm graphite, not pure black. |
| `--ink-secondary` | `oklch(0.45 0.012 60)` | Secondary text. |
| `--ink-tertiary` | `oklch(0.62 0.010 60)` | Hints, timestamps. |
| `--ink-quiet` | `oklch(0.78 0.008 60)` | Disabled, decorative. |
| `--line-hairline` | `oklch(0.92 0.005 70)` | Default border. Visible but never assertive. |
| `--line-soft` | `oklch(0.95 0.005 70)` | Internal dividers. |
| `--accent-brass` | `oklch(0.74 0.135 75)` | **Primary accent.** Warm amber/brass. |
| `--accent-brass-deep` | `oklch(0.58 0.145 65)` | Hover / pressed brass. |
| `--accent-brass-wash` | `oklch(0.96 0.030 80)` | Brass tint backgrounds. |
| `--sage-running` | `oklch(0.70 0.075 155)` | Agent active / healthy. Desaturated sage, *not* lime. |
| `--sage-wash` | `oklch(0.95 0.020 150)` | Running highlight backgrounds. |
| `--clay-warning` | `oklch(0.71 0.140 55)` | Queued, waiting, attention. |
| `--rust-failed` | `oklch(0.58 0.165 35)` | Failed, error. Not red — burnt rust. |
| `--lavender-suspended` | `oklch(0.68 0.060 305)` | Suspended / paused. Cool but desaturated. |
| `--ink-accent-on-brass` | `oklch(0.18 0.020 60)` | Text used on top of brass fills. |

### 3.2 Dark theme — "Night Bridge"

| Token | oklch | Role |
|---|---|---|
| `--bg-canvas` | `oklch(0.155 0.008 60)` | Warm graphite, not blue-black. |
| `--bg-stage` | `oklch(0.185 0.009 60)` | Stage lifts slightly. |
| `--bg-rail` | `oklch(0.135 0.008 60)` | Rails recede. |
| `--bg-sunken` | `oklch(0.115 0.007 60)` | Terminals, code. |
| `--ink-primary` | `oklch(0.94 0.005 75)` | Warm cream, not white. |
| `--ink-secondary` | `oklch(0.72 0.008 70)` | |
| `--ink-tertiary` | `oklch(0.55 0.008 70)` | |
| `--ink-quiet` | `oklch(0.40 0.008 70)` | |
| `--line-hairline` | `oklch(0.27 0.008 60)` | |
| `--line-soft` | `oklch(0.22 0.008 60)` | |
| `--accent-brass` | `oklch(0.78 0.140 78)` | Brass glows slightly hotter at night. |
| `--accent-brass-deep` | `oklch(0.66 0.150 70)` | |
| `--accent-brass-wash` | `oklch(0.30 0.060 70)` | |
| `--sage-running` | `oklch(0.74 0.085 155)` | |
| `--sage-wash` | `oklch(0.27 0.040 155)` | |
| `--clay-warning` | `oklch(0.76 0.140 60)` | |
| `--rust-failed` | `oklch(0.66 0.180 35)` | |
| `--lavender-suspended` | `oklch(0.72 0.075 305)` | |

### 3.3 Semantic role aliases (theme-agnostic)

```
--surface-base          → bg-canvas
--surface-stage         → bg-stage
--surface-rail          → bg-rail
--surface-sunken        → bg-sunken
--text                  → ink-primary
--text-soft             → ink-secondary
--text-hint             → ink-tertiary
--text-disabled         → ink-quiet
--border                → line-hairline
--divider               → line-soft
--accent                → accent-brass
--accent-hover          → accent-brass-deep
--accent-wash           → accent-brass-wash
--state-running         → sage-running
--state-queued          → clay-warning
--state-failed          → rust-failed
--state-suspended       → lavender-suspended
--state-done            → ink-secondary    /* completed = quiet, not celebrated */
```

### 3.4 Rationale

- **Why brass amber, not blue/purple/teal?** Every dev dashboard reaches for blue, violet, or cyan. Brass is warm, reads as "human/handcrafted/expensive" and shares zero DNA with Linear, Vercel, Supabase, Notion-calendar, or any AI-platform competitor.
- **Why sage instead of green?** Pure green ("running") screams CI/CD. Sage reads as "alive and stable" without the Jenkins association.
- **Why warm grays everywhere?** Cool grays + a single accent is the dev-dashboard cliché. Warm grays push us toward Things 3 / Craft / paper, away from terminals.

---

## 4. Typography

Three families. No "Inter 13px everywhere".

| Role | Family | Notes |
|---|---|---|
| **Display & headings** | **Newsreader** (Google Fonts, variable serif) | A literary, slightly editorial serif. Used for page titles, task titles, and the agent name plates. |
| **UI body** | **Inter Tight** | Variable, loaded with `wght 400 / 500 / 600` and `opsz` for small caps. Used for everything UI. |
| **Mono / terminal** | **JetBrains Mono** (already loaded) | Terminals, costs, IDs, timestamps. |

The combination of a serif display + a tight humanist sans is the thing nobody else in this category does. It immediately distances us from Linear/Vercel/Resend/Cursor.

### 4.1 Type scale

| Token | Size / line / weight | Use |
|---|---|---|
| `--type-display` | 28 / 32 / 600, Newsreader, tracking -0.02em | Page hero (Tasks, Projects, Inbox titles) |
| `--type-title` | 20 / 26 / 600, Newsreader, tracking -0.015em | Task detail title, project hero |
| `--type-section` | 13 / 18 / 600, Inter Tight, **uppercase**, tracking +0.10em | Section labels ("CONTRIBUTORS", "PROCESS") |
| `--type-body` | 14 / 21 / 400, Inter Tight | Default body text |
| `--type-body-strong` | 14 / 21 / 550, Inter Tight | Emphasized body |
| `--type-meta` | 12 / 16 / 450, Inter Tight, tracking +0.005em | Row metadata, properties |
| `--type-hint` | 11 / 14 / 450, Inter Tight, tracking +0.01em | Timestamps, hints, `kbd` labels |
| `--type-mono-sm` | 11 / 16 / 450, JetBrains Mono | IDs, costs, hashes |
| `--type-mono` | 13 / 19 / 450, JetBrains Mono | Terminal output |
| `--type-numeric-hero` | 32 / 36 / 500, Newsreader (tabular figures) | Cost meter, telemetry numerals |

Global rules:

- Body base = **14px**, not 13px. We are not a developer console; we're a command surface a CEO reads all day.
- All numerals use `font-feature-settings: 'tnum', 'cv11'`.
- Headings use `font-feature-settings: 'ss01'` on Newsreader for the alternate `g`.
- Letter-spacing is *negative* on display, *positive* on small caps. Never neutral.
- Never use `text-transform: uppercase` outside `--type-section`. Brass small-caps sections are a signature; using them everywhere would dilute the signal.

### 4.2 Anti-patterns

- No 10px text. Anywhere. If something needs to be 10px, it doesn't need to be on screen.
- No all-mono pages. Mono is *garnish*, not the meal.
- No center-aligned body text.

---

## 5. Spacing, density, rhythm

A **4-pt base** with a 6/10/16/24/40/64 step scale. The interface uses **two density modes**:

| Mode | Where | Row height | Vertical padding |
|---|---|---|---|
| **Standing** (default) | Stage, task detail | 48px rows, 24px section padding | spacious, breathing |
| **Crouched** | Lists, terminal tabs, inbox list | 36px rows, 12px section padding | dense but never cramped |

Even crouched mode is **less dense than Linear**. A Linear list row is 32px; ours is 36px. This 4px is intentional: it pushes us closer to Things 3 / Notion Calendar comfort.

### 5.1 Spacing scale tokens

```
--space-0:  0
--space-1:  4px
--space-2:  6px
--space-3:  10px
--space-4:  16px
--space-5:  24px
--space-6:  40px
--space-7:  64px
--space-8:  96px
```

Stage horizontal padding: `--space-6` (40px). Always. This generous left/right gutter is what makes the stage feel like a page rather than a panel.

### 5.2 Rhythm rules

- Vertical rhythm in the stage is on a **6px sub-grid** (so 18 / 24 / 30 / 42 work).
- Section labels (`--type-section`) always have **24px above, 12px below**.
- Cards and grouped surfaces **never** use a hard border on all four sides simultaneously — pick top-rule + soft fill, or fill alone, but avoid the boxy-cards-in-a-grid look.

### 5.3 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | chips, small inputs |
| `--radius` | 8px | buttons, fields |
| `--radius-lg` | 14px | panels, dialogs |
| `--radius-xl` | 22px | hero surfaces, the agent portrait |
| `--radius-pill` | 999px | status pips, agent dot indicators |

Large radii (14/22) are deliberately Apple-like and reject Linear's universal 6px.

---

## 6. Motion language

Two motion personalities, used carefully:

### 6.1 Spring — "agent pulse"

Used for things that represent *life*: agent status changes, new process events arriving, the cost meter ticking up.

```
spring-soft:  { stiffness: 220, damping: 28, mass: 0.9 }   // default
spring-pulse: { stiffness: 320, damping: 18, mass: 0.7 }   // status pip change
```

### 6.2 Ease — "chrome"

Used for anything UI: panel slides, hover, focus rings.

```
--ease-out-quad: cubic-bezier(0.22, 0.61, 0.36, 1)
--ease-in-out:   cubic-bezier(0.45, 0, 0.20, 1)
--dur-fast:   90ms     /* hover, color */
--dur-base:   180ms    /* panel slide, popover */
--dur-slow:   320ms    /* stage transitions */
--dur-deliberate: 520ms  /* cold-start, mode change */
```

### 6.3 Specific motion moments

- **Agent status change**: portrait pip animates with `spring-pulse`. A 1px brass ring breathes for 800ms then fades.
- **Process stream new event**: events fade-up 6px over 220ms with a subtle `--accent-wash` flash, then settle. They do **not** slide-in like chat — they *crystallize*.
- **Stage navigation**: cross-fade + 8px parallax shift, 320ms, `--ease-in-out`. Never slides full-screen left/right.
- **Telemetry rail expand**: 280ms width tween + content fade in at 80ms.
- **Cost meter tick**: digits roll with a 120ms tabular swap, no bouncing.
- **Reduced motion**: all motion collapses to a 90ms opacity fade, springs become linear ease.

---

## 7. Layout system

### 7.1 Why not a 3-pane

The instinct in this category is master/detail/properties. We reject it because:

1. It's Linear's exact signature — visual trade dress.
2. It crowds the task title into a thin middle column, killing the editorial feel we want for "what your AI crew did today."
3. It assumes the right panel is always-on metadata. For ANC, the right side is *telemetry* and is mostly latent.

### 7.2 The Bridge layout

```
┌─────────────┬──────────────────────────────────────────────┬──────┐
│             │                                              │      │
│  ROSTER     │                  STAGE                       │ TEL  │
│  RAIL       │                                              │ RAIL │
│             │     (one focused surface, generous gutters)  │      │
│  240px      │                  fluid                       │ 48px │
│             │                                              │ →420 │
└─────────────┴──────────────────────────────────────────────┴──────┘
```

**Roster rail (left, 240px)** — always visible. Top half is the *crew*: agent portraits with live state. Bottom half is *navigation* (Tasks, Projects, Inbox, Settings) styled as a list of editorial labels, not icons.

**Stage (center, fluid)** — the only thing the eye really lands on. Has a `max-content-width: 960px` for prose-heavy surfaces (task detail, inbox preview), expands fully for table-like surfaces (tasks list, projects).

**Telemetry rail (right, 48px collapsed → 420px expanded)** — collapsed default. Contains: today's burn meter, the active session count pill, the heartbeat sparkline, the "what changed in the last 5 minutes" feed. Click the rail or hit `\` to expand. Auto-expands when `--state-failed` events arrive.

### 7.3 Window chrome

There is **no top header bar** in the traditional sense. The workspace title and the command-palette trigger live as a small *floating capsule* at the top-center of the stage, 40px from the top. This is the single most visually distinctive structural choice and it actively prevents Linear/Vercel comparisons.

```
                       ╭──────────────────────────╮
                       │  ANC · CEO Bridge   ⌘K   │
                       ╰──────────────────────────╯
```

The capsule is brass-tinted in light mode, brass-rimmed in dark.

---

## 8. Core surfaces

### 8.1 Shell

```
┌────────────────┬────────────────────────────────────────────────────┬──────┐
│ ◐ ANC          │            ╭──────────────────────╮                │  ▎  │
│                │            │ Tasks       ⌘K       │                │  ▎  │
│ ── CREW ──     │            ╰──────────────────────╯                │  ▎  │
│                │                                                    │  ▎  │
│ ◉ Engineer     │      [ stage content ]                             │  ▎  │
│ ○ Strategist   │                                                    │  ▎  │
│ ◐ Ops          │                                                    │  ▎  │
│ ◌ CEO Office   │                                                    │  ▎  │
│                │                                                    │  ▎  │
│ ── BRIDGE ──   │                                                    │  ▎  │
│  Tasks      24 │                                                    │  ▎  │
│  Projects    6 │                                                    │  ▎  │
│  Inbox       3 │                                                    │  ▎  │
│  Settings      │                                                    │  ▎  │
│                │                                                    │  ▎  │
│ ── BRIDGE ──   │                                                    │  ▎  │
│ ⚙ Settings     │                                                    │  ▎  │
│                │                                                    │  ▎  │
│ ─────────────  │                                                    │  ▎  │
│  Z. Wang       │                                                    │  ▎  │
│  CEO           │                                                    │  ▎  │
└────────────────┴────────────────────────────────────────────────────┴──────┘
```

- The **CREW** section uses *agent portraits* (28px circle with brass ring, status pip top-right). Names are set in **Newsreader** italic at 14px, not Inter. This is the single typographic flourish that establishes the "ship" mood.
- The **BRIDGE** section uses Inter Tight 14px with a numeric badge tucked right. No icons in the row — the navigation is a *table of contents*, not a button strip.
- The CEO card at the bottom is a small brass-edged tile, not an avatar dropdown.
- Roster rail has **no border-right**. It's separated from the stage by a 1px hairline AND a 16px vertical gutter of `--bg-canvas`. This subtle gutter is what kills the Linear vibe more than anything else.

### 8.2 Tasks list / workspace

```
                    ╭──────────────────╮
                    │  Tasks      ⌘K   │
                    ╰──────────────────╯

  Tasks                                            ┊  24 active   ╴ filter
  ──────                                           ┊
  Today                                            ┊
                                                   ┊
  ◉  Refactor router circuit breaker          ENG  ┊  P1   $0.42  · 2m
  ◉  Draft April investor update              STR  ┊  P2   $0.18  · 14m
  ◌  Triage tmux flaky session bug            OPS  ┊  P3   $0.04  · 32m
                                                   ┊
  Yesterday                                        ┊
                                                   ┊
  ✓  Migrate workspace cleanup hook            —   ┊  P3   $1.20  · 21h
  ✓  CEO Office: weekly digest                 —   ┊  P5   $0.66  · 23h
                                                   ┊
  Earlier                                          ┊
  …                                                ┊
```

Key choices:

- **No table.** Rows are editorial entries with date dividers (Today / Yesterday / This week / Earlier). Closer to Things 3 than Linear.
- **State pip on the left** (◉ running, ◌ queued, ◐ review, ✓ done, ✕ failed) — solid 8px discs, brass for active, sage for healthy, etc. The pip is the *only* place state is encoded; no colored backgrounds, no left borders.
- **Agent role** rendered as 3-letter small caps in brass, right of the title, not in a colored chip.
- **Cost & age** in tabular mono, right-aligned in a quiet 11px row.
- **Selection** uses a 16px-radius brass-wash highlight with no border. Selected row gets +2px vertical padding (it physically *opens* slightly) — this is the signature interaction.
- Default density: standing (48px rows). `g d` toggles crouched (36px).
- **No kanban as default.** Kanban remains accessible (`v k`) but rendered as *vertical reading columns* with newsreader headings, not card grids.

Filters live in a **floating bar** at the top of the stage that fades in only when the user starts filtering (`f` to summon, `esc` to dismiss). The default state has no filter chrome at all.

### 8.3 Task detail — the hero surface

This is the single most important page. It is what the CEO opens when they want to know "what is my crew doing right now."

```
                  ╭─────────────────────────╮
                  │  ANC-142          ⌘K    │
                  ╰─────────────────────────╯


      ◉  RUNNING · ENGINEER · 6m elapsed · $0.42 burned
      ─────────────────────────────────────────────────

           Refactor router circuit breaker
           ───────────────────────────────
           Add exponential backoff with jitter and
           per-route capacity limits.

           ╭────────────────── CONTRIBUTORS ───────────────────╮
           │                                                    │
           │   ◉ Engineer · live           ◌ Ops · standby      │
           │   ◌ Strategist · idle                              │
           │                                                    │
           ╰────────────────────────────────────────────────────╯

           ── PROCESS ─────────────────────────────────────

             14:02:11   Engineer · plan
                        Identified 4 routes needing limits
             14:03:48   Engineer · edit  src/routing/limiter.ts
                        +84 -12
             14:04:30   Engineer · run   npm test
                        ✓ 142 passed
             14:05:12   Engineer · think
                        Considering jitter strategy …
             14:06:03   Engineer · edit  src/routing/circuit.ts
                        +22 -3                                    ◉ live

           ── LIVE TERMINAL ───────────────────────────────

             ╭─ engineer ──┬─ ops (standby) ─┬─ + ─╮
             │ $ npm test                          │
             │   ✓ 142 passed                      │
             │ $ git diff --stat                   │
             │   src/routing/limiter.ts | 96 ++++  │
             │   ▌                                 │
             ╰─────────────────────────────────────╯

           ── HANDOFFS ────────────────────────────────────

             →  Engineer  →  Ops    queued for review

           ── COMMENTS ────────────────────────────────────
             …
```

Notes:

- The hero "RUNNING · ENGINEER · 6m · $0.42" line is in `--type-section` (small caps, brass) — not a row of pills. It reads like a film credit.
- The task title is **Newsreader 28px**, not bold sans. Description is Newsreader 16px, regular weight. This page reads like a newspaper article with live instruments embedded in it.
- Section labels use the brass small-caps `── PROCESS ──` form with a 1px hairline rule beside them — a subtle editorial flourish that nobody else uses.
- **No properties sidebar.** Properties live in a discrete `i` (info) drawer that slides from the right when invoked. Default state: hidden.
- The **PROCESS** stream is the visual heart of the page (see §9.3).
- **LIVE TERMINAL** is a single tabbed panel inside the stage — not a separate panel. Treated as an embedded artifact, not a dashboard widget.

### 8.4 Process stream — see §9.3

### 8.5 Inbox

```
                   ╭─────────────────╮
                   │  Inbox     ⌘K   │
                   ╰─────────────────╯

      Inbox · 3 unread                                today

      ── ATTENTION ────────────────────────────────────

      ⚑  Ops escalated: tmux session ANC-138 hung 4×
         "Repeated SIGCHLD failure in workspace cleanup."
         · Ops · 11m ago · ANC-138

      ⚑  Engineer paused: needs PR review
         "Router refactor ready for sign-off."
         · Engineer · 22m ago · ANC-142

      ── INFORMATIONAL ────────────────────────────────

      ·  Strategist: weekly digest published
      ·  CEO Office: 6 tasks completed yesterday
      ·  Cost: April spend at 38% of budget

      ── ARCHIVE ──────────────────────────────────────
      …
```

- **No filter sidebar.** Filters live in a small caps row at the very top of the stage (`unread · all · archive`) styled as a typographic switch, not buttons.
- **Two visual tiers**: ATTENTION (action required) and INFORMATIONAL (FYI). Attention items get a brass `⚑` glyph. Informational items get a tiny `·`.
- Selection opens an inline expansion — the row grows to show body and a "open task" link. There is no preview pane. (This is a strong departure from the current 3-column inbox.)

### 8.6 Projects

```
                  ╭──────────────────╮
                  │  Projects   ⌘K   │
                  ╰──────────────────╯

      Projects                                          + New

      ── ACTIVE ──────────────────────────────────────

      Voltage rebrand                       ▮▮▮▮▮▮▯▯▯▯
      8 tasks · 3 running · $14.20             62%
      ───────────────────────────────────────────────

      ANC public launch                     ▮▮▮▮▮▮▮▮▯▯
      14 tasks · 2 running · $48.10            81%
      ───────────────────────────────────────────────

      ── DORMANT ─────────────────────────────────────
      …
```

- Projects are **horizontal bands**, not cards. Each band spans the full stage width with a hairline divider. The progress strip uses brass blocks on a sunken track.
- No project color chips on the band — color appears only as a 4px brass-tinted left tab on the band (the sole exception to the "no left border" rule, used here because projects are *containers*, not states).

### 8.7 Settings

A single scrollable editorial page, not a settings panel with tabs. Section labels are `── ACCOUNT ──`, `── AGENTS ──`, `── INTEGRATIONS ──`, etc. Each section has 64px of vertical padding above it. Form fields are full-width with the label *above* the field in `--type-section`.

This is closer to Stripe's or Notion's settings than to Linear's tabbed properties panel.

### 8.8 Command palette (⌘K)

```
                   ╭──────────────────────────────╮
                   │  ❯  Search bridge…            │
                   ├──────────────────────────────┤
                   │  ── JUMP ──                   │
                   │     Tasks                  ⌘1 │
                   │     Projects               ⌘2 │
                   │     Inbox                  ⌘3 │
                   │  ── ACT ──                    │
                   │     New task                ⌘N │
                   │     Dispatch agent…         ⌘D │
                   │     Toggle telemetry rail    \ │
                   │  ── CREW ──                   │
                   │     Page Engineer           gE │
                   │     Page Strategist         gS │
                   │     Page Ops                gO │
                   ╰──────────────────────────────╯
```

- Floats centered, **22px radius**, brass hairline, drop shadow at 8px blur / 24% black.
- Section headers are `--type-section` brass small caps. Built on `cmdk`.
- Width: 560px. Height: max 480px.
- Backdrop is `--bg-canvas` at 70% opacity with a 16px blur, not pitch black.

---

## 9. Component library

Naming convention: `bridge-*` to make them grep-able and to mark them as ANC-specific (vs `ui/*` shadcn primitives).

### 9.1 Buttons

| Variant | Visual | Use |
|---|---|---|
| `bridge-button-brass` | Brass fill, ink-on-brass text, 8px radius, 13px medium, 32px tall, 1px inset highlight | Primary action |
| `bridge-button-ghost` | Transparent, brass text, hairline border on hover only | Secondary |
| `bridge-button-quiet` | Transparent, ink-secondary text, no border ever | Tertiary, in toolbars |
| `bridge-button-danger` | Rust border, rust text, fills rust-wash on hover | Destructive |
| `bridge-button-icon` | 28px square, 6px radius, ink-secondary | Icon-only |

Anti-pattern: do not introduce a "primary blue" anywhere. Brass is the only call-to-action color.

### 9.2 Inputs

- 36px tall, 8px radius, 1px hairline border.
- Focus state: **2px brass ring**, no shadow, no glow. The ring is *outside* the border, so the field never resizes.
- Label above field, in `--type-section`.
- No floating labels. No filled inputs. No underlined inputs.

### 9.3 Status pip (`bridge-pip`)

A pure 8px disc with a soft 1px outer ring in the same hue. **The single source of truth for state across the whole app.**

| State | Color token | Glyph fallback |
|---|---|---|
| running | `--state-running` (sage) | ◉ |
| queued | `--state-queued` (clay) | ◌ |
| review | `--accent-brass` | ◐ |
| done | `--text-soft` (quiet on purpose) | ✓ |
| failed | `--state-failed` (rust) | ✕ |
| suspended | `--state-suspended` (lavender) | ⏸ |

When live, the pip animates: 1.6s sage breathing (`scale 1 → 1.15 → 1`, opacity `0.9 → 1`) using `spring-soft`.

### 9.4 Agent portrait (`bridge-portrait`)

A 28px circle with:
- 1px brass ring (always)
- letter monogram inside (E, S, O, C) in Newsreader italic
- status pip overlaid bottom-right
- subtle gradient fill in the agent's *role hue* (engineer = sage tint, strategist = brass tint, ops = clay tint, CEO office = lavender tint)

In the roster rail, hovering shows a tooltip with current task title and elapsed time. Clicking jumps to the agent's active task.

### 9.5 Cost display (`bridge-cost`)

Dollar amounts use **tabular Newsreader** (yes, the serif) for the digits, with the `$` glyph in Inter Tight 11px superscript. This is a tiny detail but every CEO will see this number 50× a day, and the serif numerals are the most "this is not a dev tool" signal we can send.

### 9.6 Live indicator (`bridge-live`)

A 6px sage disc + the word "live" in `--type-section` brass small caps. Pulses with `spring-pulse` every 2s. Used in the process stream and live terminal headers.

### 9.7 Chips (`bridge-chip`)

Almost-never-used. Reserved for project tags. 22px tall, 6px radius, no border, ink-on-wash. **Status is never a chip** (it's a pip + text). This single rule is how we avoid the "wall of pills" Linear/Jira look.

### 9.8 Section rule (`bridge-section`)

```
── PROCESS ────────────────────────────────────────────────
```

A small-caps label with a 1px hairline rule extending to the right edge of the stage. This is the *primary* layout primitive — every section in every surface uses it. It replaces the ubiquitous shadcn "card with a CardHeader".

---

## 10. Unique-to-ANC surfaces

These have no analogue in Linear/Jira/Notion and deserve hero treatment.

### 10.1 Live terminal tabs (`LiveTerminalTabs`)

```
╭─ engineer ▮ ─┬─ ops · standby ─┬─ strategist · idle ─┬─ + ─╮
│  $ npm test                                                │
│    ✓ 142 passed                                            │
│  $ ▌                                                       │
│                                                            │
│  ⏵ live                              attached · 14:06:11    │
╰────────────────────────────────────────────────────────────╯
```

- Tab strip uses **brass underline for active**, no rounded tab shapes (rejecting the browser-tab cliché).
- Active tab has a tiny `▮` brass cursor next to the name.
- Terminal body uses `--bg-sunken` (NOT pure black). This is critical: a black terminal in a warm-paper UI breaks the whole mood. Sunken canvas keeps it cohesive.
- 14px JetBrains Mono, 1.6 line-height, soft amber prompt, sage success, rust error.
- Bottom status bar is small-caps brass: `live · attached · 14:06:11`.
- **No traffic-light buttons.** This is not a terminal-emulator clone.

### 10.2 Contributors bar (`ContributorsBar`)

```
╭───────────────── CONTRIBUTORS ──────────────────╮
│                                                  │
│   ◉ Engineer · live · 6m       $0.42              │
│   ◌ Ops · standby                                 │
│   ◌ Strategist · idle                             │
│                                                  │
╰──────────────────────────────────────────────────╯
```

- A vertical list, **not** a horizontal avatar strip. Avatar strips are the dev-team cliché; ours reads like a film cast list.
- Each row: portrait + name (Newsreader 14px italic) + state + elapsed + cost.
- Hovering reveals a quiet inline action: "page", "suspend", "hand off →".
- The whole surface has no border, just the section rule above it.

### 10.3 Process stream (`ProcessStream`) — *the soul of the app*

The process stream is what makes ANC feel like watching a crew at work. Design it like a **ship's log**, not a chat or a CI feed.

```
── PROCESS ────────────────────────────────────────────

 14:02:11    ENGINEER · plan
             Identified 4 routes needing limits.
             ▸ src/routing/limiter.ts
             ▸ src/routing/circuit.ts

 14:03:48    ENGINEER · edit
             src/routing/limiter.ts                +84 -12

 14:04:30    ENGINEER · run
             $ npm test
             ✓ 142 passed in 18.2s

 14:05:12    ENGINEER · think
             Considering jitter strategy. Exponential
             with full jitter avoids thundering herd…

 14:06:03    ENGINEER · edit
             src/routing/circuit.ts                +22 -3      ◉ live
─────────────────────────────────────────────────────────────
```

Spec:

- Three columns: **timestamp** (mono, 11px, ink-tertiary) | **role · verb** (small-caps brass, 12px) | **payload** (Newsreader 14px for prose `think`/`plan`, JetBrains Mono 13px for `edit`/`run`).
- Rows are separated by **24px of vertical space**, not borders. The whole stream is a long editorial column.
- The current/streaming row gets a faint sage left tick and a `◉ live` pip aligned right.
- New events `crystallize` (fade-up 6px, 220ms) — never slide.
- Verbs are first-class: `plan / think / edit / run / read / search / handoff / wait / done / fail`. Each gets a tiny glyph in the small-caps line.
- **No log lines that look like terminal output unless they actually are.** The stream is interpreted, not raw.

### 10.4 Dispatch tree (`DispatchTree`)

A vertical "who handed off to whom" tree, drawn with hairlines, **never** with boxes:

```
  CEO
   └── Engineer · ANC-142
         └── Ops · review (queued)
   └── Strategist · ANC-140 · done
```

- Indent = 24px.
- Connector lines are 1px hairline.
- Each node is a single editorial line with a portrait at the start.
- Selecting a node jumps to that task. This replaces the current dialog-style dispatch UI.

### 10.5 Cost breakdown (`CostCard`)

```
── COST ────────────────────────────────────────────

       $0.42       │   ENGINEER     $0.31  73%
       ─────       │   STRATEGIST   $0.08  19%
       this task   │   OPS          $0.03   8%
                   │
       ▮▮▮▮▮▮▮▮▯▯  │   today        $4.18
       38% of $11  │   month        $142.60
```

- Hero number: Newsreader tabular numerals, 32px.
- Per-agent rows in small-caps brass with mono dollars.
- Budget bar: brass blocks on a sunken track, 8px tall, 999 radius, never animated except on tick.
- **No pie chart, no donut.** No d3, no recharts here.

### 10.6 Memory trail (`MemoryTrailCard`)

The agent's memory is the thing that makes ANC distinctive — it deserves a surface that *feels* like memory. Render it as a **vertical thread** of small dated entries, like a research notebook:

```
── MEMORY · ENGINEER ───────────────────────────────

  ▪  Apr 11   "Workspace cleanup hook needs SIGCHLD
              guard — see ANC-138 postmortem."

  ▪  Apr 09   "Router circuit breaker should use
              full jitter. Discussed with CEO."

  ▪  Apr 04   "Tmux session naming convention:
              <role>-<issueKey>."

  show 23 more
```

- Square brass bullets, dates in mono, body in Newsreader italic.
- Faint vertical hairline runs through the bullets to suggest a thread.
- This is intentionally the most "literary" surface in the entire app. It is the single moment where ANC declares its identity loudest.

### 10.7 Handoff renderer (`HandoffRenderer`)

Renders a moment when one agent passes work to another. Treated as a **crossing**, not an arrow on a card:

```
   ╴╴╴╴╴╴ ENGINEER  ──→  OPS ╴╴╴╴╴╴
            handed off · 14:08:22

         "Router refactor merged.
          Please monitor latency for 30 min."
```

- Centered.
- The `──→` is brass, 24px wide, with a soft glow.
- The body quote is Newsreader italic.
- This element should appear inline in the process stream, breaking it like a chapter break in a novel.

### 10.8 Telemetry rail (right) when expanded

```
╭──────────────────────╮
│  ── TODAY ──         │
│                      │
│    $4.18             │
│    burned            │
│                      │
│  ▮▮▮▮▮▮▮▮▯▯  38%      │
│                      │
│  ── HEARTBEAT ──     │
│   ▁▂▂▃▅▅▇▆▅▃▂▁       │
│                      │
│  ── ACTIVE ──        │
│   ◉ Engineer · ANC-142│
│   ◌ Ops · standby     │
│                      │
│  ── LAST 5 MIN ──    │
│   14:06  ENG  edit   │
│   14:05  ENG  think  │
│   14:04  ENG  run    │
│   14:03  ENG  edit   │
│                      │
╰──────────────────────╯
```

- Heartbeat is a sparkline of cost-per-minute, sage stroke, no fill.
- Auto-expands on rust events. Otherwise stays collapsed showing only a vertical brass thread with three pips.

---

## 11. Accessibility & keyboard

### 11.1 Keyboard map (canonical)

| Chord | Action |
|---|---|
| `⌘K` | Command palette |
| `g t` | Tasks |
| `g p` | Projects |
| `g i` | Inbox |
| `g s` | Settings |
| `g E` / `g S` / `g O` / `g C` | Page agent (engineer / strategist / ops / CEO office) |
| `j` / `k` | Down / up in any list |
| `↵` | Open selected |
| `f` | Summon filter bar |
| `i` | Toggle info drawer (task detail) |
| `\` | Toggle telemetry rail |
| `c` | New (context-aware: new task / new project / new comment) |
| `m` | Mark inbox item read |
| `e` | Archive inbox item |
| `?` | Open keymap overlay |

We deliberately **do not** copy Linear's `o p`, `o s`, `c` namespaces verbatim. Our `g`/`page` model frames navigation around "going to" a *crew member or surface*, which fits the bridge metaphor.

### 11.2 Focus

- 2px brass outer ring, 2px offset, never blue.
- Every interactive surface has a visible focus state (no `:focus { outline: none }`).
- Skip-link: "Skip to stage" at the top of every page.

### 11.3 Reduced motion

`prefers-reduced-motion: reduce` collapses:
- All springs → 90ms linear opacity fade
- Crystallize stream events → instant
- Heartbeat → static last value
- Pip breathing → static

### 11.4 Color contrast

- All text against `--surface-stage` meets WCAG AA at minimum (verified for both themes).
- Brass on stage: 4.6:1 (AA pass for 14px+).
- Sage running pip is reinforced by glyph and animation, never color alone.
- Never encode state with color only — pip + label always travel together.

---

## 12. Implementation notes

### 12.1 Token additions to `globals.css`

Add a new `@theme inline` block beneath the existing one with the bridge tokens (full token list in §3 + §5). Keep the legacy `--background`/`--foreground` aliases pointing at the new tokens for backward compatibility during migration; remove after the redesign lands.

```css
:root {
  /* Bridge tokens — see DESIGN_SPEC.md §3 */
  --bg-canvas: oklch(0.985 0.004 75);
  --bg-stage:  oklch(0.995 0.003 75);
  --bg-rail:   oklch(0.965 0.006 75);
  --bg-sunken: oklch(0.945 0.008 70);
  /* … etc */

  --accent-brass:      oklch(0.74 0.135 75);
  --accent-brass-deep: oklch(0.58 0.145 65);
  --accent-brass-wash: oklch(0.96 0.030 80);

  --state-running:   oklch(0.70 0.075 155);
  --state-queued:    oklch(0.71 0.140 55);
  --state-failed:    oklch(0.58 0.165 35);
  --state-suspended: oklch(0.68 0.060 305);

  /* Legacy aliases — remove after migration */
  --background: var(--bg-canvas);
  --foreground: var(--ink-primary);
  --primary: var(--accent-brass);
  --primary-foreground: var(--ink-accent-on-brass);
}
```

Delete entirely:
- The `linear-row`, `linear-sidebar-item`, `linear-section-label` classes (and rename any consumers to `bridge-*`).
- The `--font-heading: var(--font-sans)` line — heading font is now Newsreader.

Add fonts:
```css
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter+Tight:wght@400;450;500;550;600&display=swap');
```

Set `html { font-size: 14px; }` (was 13px) and update body `font-family: 'Inter Tight', system-ui, …`.

### 12.2 Libraries to pull in

| Lib | Purpose | Notes |
|---|---|---|
| `framer-motion` | Spring + crystallize animations | Already a likely dep; if not, add. |
| `cmdk` | Command palette | Replace any custom palette. |
| `vaul` | Bottom drawers (mobile + info drawer) | Apple-feeling drag dismiss. |
| `react-resizable-panels` | Telemetry rail expand/collapse | If we want drag-resize. |
| `@number-flow/react` | Cost meter tabular roll | Optional but very on-brand. |

Do **not** add: recharts, d3, nivo, react-icons. Sparkline = inline SVG, ~20 lines.

### 12.3 shadcn components — keep / replace / write from scratch

| Component | Action |
|---|---|
| `Button` | **Replace** with `BridgeButton` (5 variants from §9.1). Keep shadcn `button.tsx` only as primitive. |
| `Dialog` | **Keep**, restyle (22px radius, brass hairline). |
| `DropdownMenu` | **Keep**, restyle. |
| `Input` / `Textarea` | **Restyle** (no fill, hairline border, 2px brass ring focus). |
| `ScrollArea` | **Keep**. |
| `Tabs` | **Replace** with `BridgeTabs` (brass underline, no rounded background). |
| `Tooltip` | **Keep**, restyle (sunken bg, 11px Inter Tight). |
| `Avatar` | **Replace** with `BridgePortrait`. |
| `Card` | **Delete**. We don't use cards. Replace consumers with `bridge-section`. |
| `Badge` | **Delete**. We use pips. |

Write from scratch:
- `BridgePip`, `BridgePortrait`, `BridgeSection`, `BridgeCost`, `BridgeLive`, `BridgeRosterRail`, `BridgeTelemetryRail`, `BridgeStage`, `BridgeCommandCapsule`.
- Rebuild `ProcessStream`, `LiveTerminalTabs`, `ContributorsBar`, `MemoryTrailCard`, `HandoffRenderer`, `DispatchTree`, `CostCard` against the new tokens; keep their data interfaces unchanged so the integration with `lib/api.ts` is untouched.

### 12.4 File map for the implementer

```
apps/web/src/
  app/
    globals.css                  ← rewrite token block + delete .linear-* classes
    layout.tsx                   ← swap font import
  components/
    bridge/                      ← NEW directory, all bridge primitives
      pip.tsx
      portrait.tsx
      section.tsx
      cost.tsx
      live.tsx
      stage.tsx
      command-capsule.tsx
      roster-rail.tsx
      telemetry-rail.tsx
      button.tsx
      tabs.tsx
    app-shell.tsx                ← rewrite to use roster-rail + stage + telemetry-rail
    sidebar.tsx                  ← DELETE (replaced by roster-rail)
    header.tsx                   ← DELETE (replaced by command-capsule)
    task-detail/
      ProcessStream.tsx          ← rewrite per §10.3
      LiveTerminalTabs.tsx       ← rewrite per §10.1
      ContributorsBar.tsx        ← rewrite per §10.2
      MemoryTrailCard.tsx        ← rewrite per §10.6
      HandoffRenderer.tsx        ← rewrite per §10.7
      DispatchTree.tsx           ← rewrite per §10.4
      CostCard.tsx               ← rewrite per §10.5
```

### 12.5 Migration order (suggested)

1. Tokens + fonts in `globals.css`. Sanity-check both themes. (~½ day)
2. Build `bridge/*` primitives in isolation in a Storybook-less route (`/dev/bridge`). (~1 day)
3. Replace `app-shell` with the bridge layout. Existing pages still render in the stage; they just look wrong. (~½ day)
4. Rewrite `tasks/page.tsx` list to the editorial form. (~1 day)
5. Rewrite `tasks/[id]/task-detail-view.tsx` and the seven hero components. (~2 days)
6. Rewrite inbox, projects, settings against bridge primitives. (~1 day)
7. Command palette swap to `cmdk`. (~½ day)
8. Telemetry rail. (~½ day)
9. Polish + reduced-motion + a11y pass. (~1 day)

~8 days for one focused implementer.

---

## 13. Non-goals

We are explicitly **not** doing:

- Imitating Linear's 3-pane master/detail/properties layout.
- Imitating Linear's color (purple-on-near-black), border-l-2 selection, 32px row height, or icon-strip sidebar.
- Adopting Linear's `o`/`c`/`g` keyboard namespace verbatim.
- Using the Linear icon set or Lucide icons styled to look like it (we keep Lucide for utility icons but at 14px / `--ink-secondary` only, never as the visual anchor of any component).
- A boxy card-grid dashboard. No `Card` component anywhere.
- A "stats tile row" at the top of any page (no KPI tiles). Telemetry lives in the rail.
- A floating action button.
- A blue / violet / cyan accent. Anywhere.
- A second "primary" color. There is exactly one accent: brass.
- Pie charts, donut charts, treemaps.
- Avatars showing photographs. Agents are monograms, not photos.
- A "dark mode is the default" stance. **Light mode is the default** for the bridge — this is rare in the category and reinforces the "warm command surface" feel. Users can switch to night bridge.
- Mobile-first responsive. This is a desktop CEO surface. We support down to 1024px and degrade gracefully below; we do not design phone screens.

---

## 14. Open questions for the implementer

1. Should the **roster rail** remember collapse state per-user? Recommendation: no, always expanded — it's the identity of the app.
2. Should the **process stream** support a "raw mode" that shows underlying tool calls verbatim? Recommendation: yes, behind a `r` toggle, rendered in mono with sunken background. Default = interpreted mode.
3. **Sounds.** A faint mechanical click on stage navigation and a soft amber ping on `failed` events would reinforce the bridge metaphor. Recommendation: ship muted by default, expose in Settings → Sound. Use Web Audio, no asset files.
4. **Newsreader at 13px italic** for agent names — verify legibility in dark mode at 1× DPI before committing. If weak, fall back to Inter Tight italic 14px and accept the lost flourish.

---

## Appendix A — Quick agent prompt

> Build me an ANC dashboard surface. Use the bridge metaphor: roster rail (left, agents as portraits, navigation as editorial labels), single focused stage (center, generous 40px gutters, Newsreader serif headings, Inter Tight body), collapsible telemetry rail (right, 48→420). One accent only: brass amber `oklch(0.74 0.135 75)`. State is encoded with an 8px pip + label, never with chips or background fills. Use `bridge-section` (small-caps brass label + hairline rule) instead of cards. Live elements crystallize (fade-up 6px) instead of sliding. Light mode is default. Do not use blue, purple, or boxy cards.

---

*End of spec. The next agent should be able to start at §12.5 step 1 with no further questions.*
