# Bru Café Screen — Runtime Load Profile

Target: one in-store monitor running `/bru_cafe/Screen` in a kiosk browser, **16–18 hours per day, unattended**, on a low-spec media player.

All interval/TTL figures below are read directly from source. Anything marked *(est.)* is a modelled estimate, not measured on the target hardware.

---

## 1. What actually runs on the screen

The screen is a static React SPA. It holds **no business logic and no external API keys** — every outbound call goes to its own origin (`location.hyperglow.co.uk/bru_cafe/api/*`). All AI, Google Sheets, weather and SerpApi work happens on the VPS. This is the single most important fact for sizing: the monitor is a *thin client*.

### Continuous timers (source: `BruRecommendation.jsx`, `useWeather.js`, `useQuotes.js`, `GoogleReviews.jsx`)

| Timer | Interval | Ticks / hour | Ticks / 17 h | Cost per tick |
|---|---|---|---|---|
| Clock (`setNow(new Date())`) | **1 s** | 3,600 | **61,200** | Full re-render of the board tree |
| Item rotation | 20 s | 180 | 3,060 | State change + CSS animation |
| Exit-animation timeout | per rotation | 180 | 3,060 | Timer + re-render |
| Review carousel step | 6 s (only while UI 2 is on screen) | ~variable | — | GPU transform only |
| `requestAnimationFrame` snap-reset | per carousel wrap | low | — | 2 frames |

### Network requests from the screen

| Endpoint | Interval | Req / hour | Req / 17 h | Payload |
|---|---|---|---|---|
| `/api/recommendation` | 15 min | 4 | 68 | **5.4 KB** (measured from `.recommendation-cache.json`) |
| `/api/weather` | 10 min | 6 | 102 | ~0.7 KB |
| `/api/sheets?type=quotes` | **30 s** | 120 | **2,040** | 2 B – 1 KB |
| `/api/google-reviews` | 60 min | 1 | 17 | 3–5 KB |
| **Total** | | **131** | **2,227** | |

**JSON traffic ≈ 1.2 MB per day. With HTTP headers ≈ 2.5 MB per day.** Effectively nothing.

### Images

77 PNG product images in `product-images/`, served same-origin with `Cache-Control: max-age=7d` (`server.js:2020`). Only **3–4 are referenced per 15-minute refresh**, and the same items repeat heavily across a day.

- Cold start (empty cache): only the 3–4 current images are fetched, not all 77.
- Over a full 17 h day the AI will cycle through roughly **40–70 distinct items** *(est.)*.
- Once fetched, a repeat is a free disk-cache hit for 7 days.

> ⚠ **I could not measure the PNG file sizes** (the analysis sandbox was unavailable). Run this on the VPS and treat it as the key unknown:
> ```
> du -sh product-images && ls -lS product-images | head
> ```
> If the average is ~1.5 MB, first-day image traffic is **60–105 MB**, dropping to **10–30 MB/day** in steady state. If they are 3–5 MB each, see §5 — that becomes the dominant cost on this hardware.

---

## 2. Memory budget *(est., Chromium at 1920×1080)*

| Component | Typical | Notes |
|---|---|---|
| Browser + network + utility processes | 120–200 MB | Fixed Chromium baseline |
| Renderer (the tab) | 90–160 MB | React 19 + a small DOM; JS heap itself is only a few MB |
| GPU process / compositor | 100–250 MB | Inflated by `backdrop-blur` layers — see §5 |
| Decoded image cache | 20–60 MB | A 1024×1024 PNG costs **4 MB decoded as RGBA**, regardless of file size |
| **Total at 1080p** | **~450–700 MB** | |
| **Total at 4K** | **~700 MB – 1.1 GB** | Framebuffer and blur surfaces scale with pixel count |

### Recommended minimum spec

| | Minimum | Comfortable |
|---|---|---|
| RAM | **4 GB** | 8 GB |
| CPU | Dual-core x86 ≥ 1.5 GHz, or quad-core Cortex-A55 class | Quad-core x86 |
| GPU | Any with **working hardware compositing** in the browser | — |
| Storage | 2 GB free (browser cache + OS) | — |
| Network | 2 Mbps, tolerant of dropouts | — |

**2 GB RAM will run it but with no headroom** — one browser update or a memory-hungry OS process and the renderer gets killed mid-shift.

### CPU expectation *(est.)*

- Modern quad-core: **3–8%** steady.
- Weak dual-core / ARM SoC: **15–35%** steady, with spikes during the 2.5 s slide-out + 800 ms slide-in transition every 20 s.
- The 1 s clock tick and `backdrop-blur` are the two things pushing the low end of that range up. Both are fixable (§5).

---

## 3. Caching — client side

| Layer | TTL | Effect |
|---|---|---|
| Product images | 7 days (`maxAge: "7d"`) | Repeat items are free after first load |
| All `/api/*` responses | `Cache-Control: no-store` | Every poll is a real round trip |
| JS/CSS bundle | Vite content-hashed filenames | Fetched once, cached until redeploy |

There is **no service worker and no offline fallback**. If the network drops, the last-rendered state stays on screen and a small red globe icon appears; nothing crashes, but nothing updates either. That is acceptable behaviour for a café screen.

---

## 4. Server / API cost per screen (VPS side, for reference)

Driven by `setInterval(refreshRecommendationsInBackground, 15 min)` in `server.js` — this runs **independently of whether any screen is connected**.

| Upstream | Trigger | Calls / day |
|---|---|---|
| **OpenAI** `gpt-4o-mini` (recommendations) | 15-min tick, but skipped when the state hash is unchanged and cache < 2 h old. The hash includes an **hour bucket**, so it changes at least hourly | **~16–24** |
| **met.no** (weather) | 2 calls (forecast + sunrise) per 15-min hash check, plus widget cache misses (5 min TTL vs 10 min polling) | **~400–500** |
| **Google Sheets** | 1 full `A:Z` read per actual rebuild | ~16–24 |
| **SerpApi** (reviews) | 6 h TTL | 4 (~120/month — inside the 250 free tier) |
| **OpenAI moderation** (reviews) | Once per *new* review, cached in memory by review ID | ~0 steady state |

**Token note:** each recommendation call sends the *entire* 77-item menu with full natural-language conditions — roughly **10,000–15,000 input tokens per call** *(est.)*. At ~20 calls/day that is ~250k input tokens/day on gpt-4o-mini: a few pence, but worth knowing if the menu grows or you add screens.

⚠ **The in-memory `reviewModerationCache` is lost on every server restart**, which re-triggers up to 12 OpenAI moderation calls. Harmless, but it means PM2 restart loops would multiply AI cost.

---

## 5. Optimisations, ranked by impact on a weak monitor

### 1. Stop re-rendering the whole board every second — *biggest CPU win*
`BruRecommendation.jsx:60` ticks at 1 s, but the display only shows **hours and minutes**. That is 60× more re-renders than the UI can show, ~61,000 wasted full-tree renders per day.
**Fix:** move the clock into its own leaf component, and/or tick every 15–30 s. Expected saving: most of the app's steady-state CPU.

### 2. Remove `backdrop-blur-md` — *biggest GPU win*
Used on the left panel (`:239`) and the weather bar (`:340`). `backdrop-filter` forces the compositor to re-blur the region behind it whenever anything under it changes — on integrated/ARM GPUs this is a permanent tax and a common cause of kiosk stutter.
**Fix:** replace with a flat `bg-black/30`. Visually near-identical over a static background.

### 3. Delete the dead quotes poll — *~2,000 wasted requests/day*
`useQuotes()` is still called at `BruRecommendation.jsx:26`, but `<QuotesSection>` is commented out (`:381`). It polls `/api/sheets?type=quotes` **every 30 seconds** and throws the result away.
**Fix:** remove the `useQuotes` import and call. Cuts screen requests from 131/h to **11/h**.

### 4. Downscale and convert the product images
The image renders at `w-[480px]` inside a `w-[239px]` container. Serving 1024px+ PNGs to fill 480 CSS px wastes both bandwidth and — more importantly — **decode CPU and RAM**, since decoded size depends on the source pixels, not the display size.
**Fix:** pre-generate WebP at ~960px wide. Typically **70–85% smaller files** and proportionally less decode work.

### 5. Add a nightly reload — *essential for a 16–18 h unattended run*
Long-lived Chromium tabs accumulate heap fragmentation and compositor state. Every kiosk deployment needs this.
**Fix:** either a `setTimeout(() => location.reload(), 6 * 60 * 60 * 1000)` in the app, or an OS-level cron restart of the kiosk browser outside trading hours.

### 6. Add a render watchdog
If an unhandled exception kills the React tree, the screen goes blank and stays blank until someone walks past.
**Fix:** an error boundary that calls `location.reload()`, plus a heartbeat (e.g. if `/api/recommendation` has failed for > 30 min, reload).

### 7. Align the weather TTL with the poll interval
`WIDGET_WEATHER_TTL_MS` is 5 min (`server.js:1491`) but the client polls every 10 min — so **every poll is a cache miss** and hits met.no twice. Raising the server TTL to 15 min cuts upstream weather calls by roughly half.

---

## 6. Bottom line

The screen itself is light: **~2.5 MB/day of API traffic, ~130 requests/hour, no keys, no heavy computation.** All the real work is on the VPS.

What will actually hurt on limited hardware is not the data — it is the **1-second full re-render**, the **`backdrop-blur` compositing**, and **oversized PNG decodes**. Fix those three and this will run comfortably on a 4 GB, dual-core box for 18 hours a day.

Add the nightly reload and the watchdog regardless. Unattended screens fail quietly, and the failure mode you cannot recover from remotely is the one that costs you.
