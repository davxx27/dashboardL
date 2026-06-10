# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Goals tracker (Day Ring, Goal Ticker, To Do list) — the home page |
| [health.html](health.html) | Supplement / daily stack tracker |
| [po-water.html](po-water.html) | Water intake tracker |
| [finance.html](finance.html) | Finances |
| [gym.html](gym.html) | Progressive overload gym tracker |
| [topbar.js](topbar.js) | Shared top bar — auto-injected into pages that `<script src="topbar.js">` |
| [vitals.html](vitals.html) | Sleep, HRV, recovery, resting HR, steps, mood & energy check-in |
| [nutrition.html](nutrition.html) | Calories & macros, adherence %, body-weight trend coach |
| [body.html](body.html) | Body composition, measurements & progress photos |
| [performance.html](performance.html) | Deep work / english / business / social time + personal brand |
| [reflection.html](reflection.html) | Daily journal (what worked / what didn't / free) |
| [analytics.html](analytics.html) | Cross-module trends, correlations & consistency heatmaps |
| [theme.css](theme.css) + [ui.js](ui.js) | Shared design system & helpers for the new pages |
| [sync.js](sync.js) | Private cross-device sync (Supabase Auth + RLS) |

Each app stores its own state in browser `localStorage`. No accounts, no server.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.
