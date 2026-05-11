import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ENV
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const QUOTE_SCRIPT_URL = process.env.QUOTE_SCRIPT_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QUOTE_SHEET_ID = process.env.QUOTE_SHEET_ID;
const BRU_FOOD_SHEET_ID = process.env.BRU_FOOD_SHEET_ID;

const SCREEN_LOGIN_TOKEN = process.env.SCREEN_LOGIN_TOKEN;
const AUTH_COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET;
const PORT = process.env.PORT || 3002;
const URL_PREFIX = process.env.URL_PREFIX || "/bru_cafe";

// Paths
const AUTH_COOKIE_NAME = "hg_bru_screen_auth";

// EXTERNAL paths (browser-visible, used in redirects & HTML responses)
const MAIN_PATH = `${URL_PREFIX}/Screen`;
const MESSAGE_PATH = `${URL_PREFIX}/Message`;
const LOGIN_PATH = `${URL_PREFIX}/Login`;

// INTERNAL paths (used to match req.path — Nginx strips the prefix before forwarding)
const ROUTE_MAIN = "/Screen";
const ROUTE_MESSAGE = "/Message";
const ROUTE_LOGIN = "/Login";

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Basic banned words check
const bannedWords = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "ashole",
  "cunt",
  "dick",
  "piss",
  "slut",
  "whore",
];

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function collapseRepeats(text = "") {
  return text.replace(/(.)\1+/g, "$1");
}

function isMessageSafe(text = "") {
  const cleanText = collapseRepeats(normalizeText(text));
  return !bannedWords.some((word) => cleanText.includes(word));
}

// OpenAI moderation
async function isAiMessageSafe(text = "") {
  const cleanText = String(text || "").trim();

  if (!cleanText) return true;

  if (!openai) {
    console.warn("OPENAI_API_KEY missing. Holding for review.");
    return "unknown";
  }

  try {
    const moderation = await openai.moderations.create({
      model: "omni-moderation-latest",
      input: cleanText,
    });

    return !moderation.results?.[0]?.flagged;
  } catch (error) {
    console.error("AI moderation failed:", error?.message || error);
    return "unknown";
  }
}

async function moderateMessage(text = "") {
  if (!openai) {
    return {
      status: "unknown",
      filtered: "",
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
You are a strict moderator for a public café display screen.

Step 1: Correct spelling and grammar.
Step 2: Check if the message is suitable for public display.

Allow only:
- positive messages
- friendly café messages
- motivational messages
- polite customer comments

Reject:
- offensive content
- negative comments
- personal attacks
- inappropriate words
- political, religious, adult, or sensitive content

Respond in JSON format ONLY:
{
  "status": "approved" OR "rejected",
  "filtered": "corrected message"
}
          `,
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const raw = response.choices[0].message.content.trim();

    try {
      return JSON.parse(raw);
    } catch {
      console.error("LLM JSON parse failed:", raw);
      return {
        status: "unknown",
        filtered: "",
      };
    }
  } catch (error) {
    console.error("LLM failed:", error.message);
    return {
      status: "unknown",
      filtered: "",
    };
  }
}

// Cookie auth
function sign(value) {
  return crypto
    .createHmac("sha256", AUTH_COOKIE_SECRET || "")
    .update(value)
    .digest("hex");
}

function createCookieValue() {
  const payload = "authorized";
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function verifyCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return false;

  const [payload, signature] = cookieValue.split(".");

  if (!payload || !signature) return false;

  return payload === "authorized" && signature === sign(payload);
}

// Google Sheets fetch helper
async function fetchSheetRange(sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range,
  )}?key=${GOOGLE_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Google Sheets error");
  }

  return data.values || [];
}

// Format a Date as "YYYY-MM-DD HH:MM:SS" in 24-hour Europe/London time,
// suitable for the Recommendation Log sheet. We use the "sv-SE" locale
// because Swedish formatting matches the ISO-ish layout we want, and
// `hour12: false` guarantees the 24-hour clock regardless of host locale.
function format24HourLondon(date = new Date()) {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: "Europe/London",
    hour12: false,
  });
}

// Date parser for quote 1-hour filter
function parseSheetDate(dateStr) {
  if (!dateStr) return NaN;

  const raw = String(dateStr).trim();

  const normalDate = new Date(raw).getTime();
  if (!Number.isNaN(normalDate)) return normalDate;

  const parts = raw.split(/[\s/:]+/).map(Number);

  if (parts.length < 5) return NaN;

  const [day, month, year, hour, minute, second = 0] = parts;

  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

// Weather
async function getCurrentWeather() {
  const latitude = 52.6369;
  const longitude = -1.1398;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}` +
    `&longitude=${longitude}` +
    `&current=temperature_2m,precipitation,weather_code,is_day` +
    `&timezone=Europe%2FLondon`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error("Failed to fetch weather");
  }

  return data.current;
}

function getWeatherLabel(weatherCode, precipitation = 0) {
  if (precipitation > 0) return "Rainy";

  if ([0].includes(weatherCode)) return "Clear";
  if ([1, 2, 3].includes(weatherCode)) return "Cloudy";
  if ([45, 48].includes(weatherCode)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(weatherCode)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return "Rainy";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "Snowy";
  if ([95, 96, 99].includes(weatherCode)) return "Stormy";

  return "Mild";
}

// ----------------- Food sheet parsing & rules -----------------

function findHeaderIndex(headers, candidates) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const normalizedHeaders = headers.map(norm);

  for (const cand of candidates) {
    const target = norm(cand);
    const idx = normalizedHeaders.indexOf(target);
    if (idx !== -1) return idx;
  }

  for (const cand of candidates) {
    const target = norm(cand);
    const idx = normalizedHeaders.findIndex((h) => h.includes(target));
    if (idx !== -1) return idx;
  }

  return -1;
}

function parseFoodSheet(rows) {
  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());

  const nameIdx = findHeaderIndex(headers, ["Product Name", "Name"]);
  const descIdx = findHeaderIndex(headers, [
    "Product Description",
    "Description",
  ]);
  const condIdx = findHeaderIndex(headers, [
    "Recommendation Condition",
    "Condition",
  ]);
  const recIdx = findHeaderIndex(headers, ["Recommended"]);
  const textIdx = findHeaderIndex(headers, [
    "Recommendation Text",
    "Display Text",
  ]);
  const urlIdx = findHeaderIndex(headers, ["Url", "URL", "Image", "Image Url"]);

  if (nameIdx === -1 || urlIdx === -1) {
    return [];
  }

  return rows
    .slice(1)
    .map((row) => ({
      productName: String(row[nameIdx] || "").trim(),
      productDescription:
        descIdx !== -1 ? String(row[descIdx] || "").trim() : "",
      condition: condIdx !== -1 ? String(row[condIdx] || "").trim() : "",
      recommendedFlag: recIdx !== -1 ? String(row[recIdx] || "").trim() : "",
      recommendationText:
        textIdx !== -1 ? String(row[textIdx] || "").trim() : "",
      url: String(row[urlIdx] || "").trim(),
    }))
    .filter((item) => item.productName && item.url);
}

function evaluateCondition(condition, weather) {
  if (!condition) return true;

  const text = String(condition).toLowerCase();
  const tempC = Number(weather.temperature_2m);
  const precipitation = Number(weather.precipitation || 0);
  const weatherCode = Number(weather.weather_code);
  const isDay = Boolean(weather.is_day);

  let matchAll = true;

  const between = text.match(
    /temp\w*\s+between\s+(-?\d+(?:\.\d+)?)\s*(?:and|to|-)\s*(-?\d+(?:\.\d+)?)/,
  );
  if (between) {
    const low = Number(between[1]);
    const high = Number(between[2]);
    matchAll = matchAll && tempC >= low && tempC <= high;
  } else {
    const aboveMatch = text.match(
      /temp\w*\s+(?:above|over|greater than|more than|>=?|higher than)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (aboveMatch) {
      matchAll = matchAll && tempC > Number(aboveMatch[1]);
    }

    const belowMatch = text.match(
      /temp\w*\s+(?:below|under|less than|lower than|<=?)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (belowMatch) {
      matchAll = matchAll && tempC < Number(belowMatch[1]);
    }

    const equalsMatch = text.match(
      /temp\w*\s+(?:equals?|is|=)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (equalsMatch) {
      matchAll = matchAll && Math.round(tempC) === Number(equalsMatch[1]);
    }
  }

  if (/\brain(?:y|ing)?\b/.test(text)) {
    matchAll =
      matchAll &&
      (precipitation > 0 ||
        [61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode));
  }
  if (/\bsunny\b|\bclear\b/.test(text)) {
    matchAll = matchAll && weatherCode === 0;
  }
  if (/\bcloudy\b/.test(text)) {
    matchAll = matchAll && [1, 2, 3].includes(weatherCode);
  }
  if (/\bsnow(?:y|ing)?\b/.test(text)) {
    matchAll = matchAll && [71, 73, 75, 77, 85, 86].includes(weatherCode);
  }
  if (/\bfog(?:gy)?\b/.test(text)) {
    matchAll = matchAll && [45, 48].includes(weatherCode);
  }
  if (/\bday(?:time)?\b/.test(text)) {
    matchAll = matchAll && isDay;
  }
  if (/\bnight(?:time)?\b/.test(text)) {
    matchAll = matchAll && !isDay;
  }

  return matchAll;
}

async function rankFoodItemsWithAI({ weather, items }) {
  if (!items.length) return items;
  if (!openai || items.length === 1) return items;

  const weatherLabel = getWeatherLabel(
    weather.weather_code,
    weather.precipitation,
  );

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You are ranking café menu items for a public display screen.

You will receive the current weather and a list of pre-filtered food items
(already known to be appropriate for the weather based on rules).

Order them from MOST suitable to LEAST suitable for right now,
considering weather, time of day, and typical café customer behaviour.

Respond ONLY in valid JSON of the form:
{ "order": ["Product Name 1", "Product Name 2", ...] }

The "order" array MUST contain every input product name exactly once,
spelled exactly as given.
          `,
        },
        {
          role: "user",
          content: JSON.stringify({
            weather: {
              temperatureC: weather.temperature_2m,
              precipitation: weather.precipitation,
              weatherCode: weather.weather_code,
              weatherLabel,
              isDay: weather.is_day,
            },
            items: items.map((i) => ({
              productName: i.productName,
              description: i.productDescription,
            })),
          }),
        },
      ],
    });

    const raw = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed?.order) ? parsed.order : [];

    const byName = new Map(items.map((i) => [i.productName, i]));
    const ordered = [];
    for (const name of order) {
      const item = byName.get(name);
      if (item && !ordered.includes(item)) ordered.push(item);
    }
    for (const item of items) {
      if (!ordered.includes(item)) ordered.push(item);
    }

    return ordered;
  } catch (error) {
    console.error("AI ranking failed:", error.message);
    return items;
  }
}

async function generateRecommendationTextForItem({ item, context }) {
  if (!openai) {
    console.warn(
      `[AI text] OPENAI_API_KEY is missing — falling back for "${item.productName}"`,
    );
    return "";
  }

  // Try up to 2 times — transient OpenAI hiccups (rate limits, network)
  // shouldn't permanently degrade an item to its "Try our X" fallback.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You write ONE short, punchy café recommendation line for a digital screen.

The line will appear inside a comic-book speech bubble next to a single
menu item. It must feel hand-written for THIS item, not generic.

Strict rules:
- Maximum 12 words.
- Sound like a cheeky, friendly barista talking to a customer.
- Tie the line to the current weather and time of day where it feels natural.
- Reference the item's flavour, texture, or vibe — not just its name.
- No emojis, no hashtags, no quotation marks, no exclamation overload.
- Do NOT use the product name as the entire line.

Respond ONLY in valid JSON of the form:
{ "text": "your single line here" }
          `,
          },
          {
            role: "user",
            content: JSON.stringify({
              context,
              item: {
                productName: item.productName,
                description: item.productDescription,
                condition: item.condition,
              },
            }),
          },
        ],
      });

      const raw = response.choices[0]?.message?.content?.trim() || "";
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        console.error(
          `[AI text] JSON parse failed for "${item.productName}" (attempt ${attempt}). Raw response:`,
          raw,
        );
        if (attempt < 2) continue;
        return "";
      }

      // Be tolerant of slight prompt drift — accept text/line/recommendation
      const text =
        (typeof parsed?.text === "string" && parsed.text.trim()) ||
        (typeof parsed?.line === "string" && parsed.line.trim()) ||
        (typeof parsed?.recommendation === "string" &&
          parsed.recommendation.trim()) ||
        "";

      if (!text) {
        console.warn(
          `[AI text] Empty text for "${item.productName}" (attempt ${attempt}). Parsed:`,
          parsed,
        );
        if (attempt < 2) continue;
        return "";
      }

      return text;
    } catch (error) {
      const status = error?.status || error?.response?.status;
      const message = error?.message || String(error);
      console.error(
        `[AI text] OpenAI call failed for "${item.productName}" (attempt ${attempt}, status ${status || "n/a"}):`,
        message,
      );
      if (attempt < 2) {
        // brief backoff before retry
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return "";
    }
  }

  return "";
}

function buildAiContext(weather) {
  const weatherLabel = getWeatherLabel(
    weather.weather_code,
    weather.precipitation,
  );
  const tempC = Math.round(Number(weather.temperature_2m));
  const partOfDay = (() => {
    const hour = new Date().getHours();
    if (hour < 11) return "morning";
    if (hour < 15) return "lunchtime";
    if (hour < 18) return "afternoon";
    return "evening";
  })();

  return {
    weatherLabel,
    temperatureC: tempC,
    precipitation: weather.precipitation,
    isDay: weather.is_day,
    partOfDay,
  };
}

async function generateRecommendationTexts({ weather, items }) {
  if (!items.length) return new Map();
  if (!openai) {
    console.warn(
      "[AI text] OPENAI_API_KEY is missing — no AI bubble text will be generated",
    );
    return new Map();
  }

  const context = buildAiContext(weather);

  // Run a separate OpenAI call per item, in parallel
  const results = await Promise.all(
    items.map(async (item) => {
      const text = await generateRecommendationTextForItem({ item, context });
      return [item.productName, text];
    }),
  );

  const map = new Map();
  for (const [name, text] of results) {
    if (name && text) {
      map.set(String(name).trim(), text);
    }
  }
  console.log(
    `[AI text] generated ${map.size}/${items.length} bubble lines (failures fall back to sheet text)`,
  );
  return map;
}

function buildReasonString(item, weather) {
  const weatherLabel = getWeatherLabel(
    weather.weather_code,
    weather.precipitation,
  );
  const tempC = Math.round(Number(weather.temperature_2m));
  const conditionPart = item.condition
    ? `condition "${item.condition}"`
    : "no specific condition";
  return `${conditionPart} matched (weather: ${weatherLabel}, ${tempC}°C)`;
}

// Login routes
app.get("/server-login", (req, res) => {
  try {
    const token = String(req.query.token || "");

    if (!SCREEN_LOGIN_TOKEN) {
      return res.status(500).send("Missing SCREEN_LOGIN_TOKEN");
    }

    if (!AUTH_COOKIE_SECRET) {
      return res.status(500).send("Missing AUTH_COOKIE_SECRET");
    }

    if (token !== SCREEN_LOGIN_TOKEN) {
      return res.status(401).send("Invalid token");
    }

    res.cookie(AUTH_COOKIE_NAME, createCookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: "/",
    });

    return res.send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="1;url=${MAIN_PATH}" />
        </head>
        <body style="font-family: Arial; background:#111; color:#fff;">
          <h2>Device authorized</h2>
          <p>Logging in to Bru Café screen...</p>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(error.message || "Login error");
  }
});

app.get("/server-logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  return res.redirect(LOGIN_PATH);
});

// Protect main screen only
app.use((req, res, next) => {
  const requestPath = req.path;

  const isMainPath =
    requestPath === ROUTE_MAIN || requestPath.startsWith(`${ROUTE_MAIN}/`);

  const isPublicPath =
    requestPath === ROUTE_MESSAGE ||
    requestPath.startsWith(`${ROUTE_MESSAGE}/`) ||
    requestPath === ROUTE_LOGIN ||
    requestPath.startsWith(`${ROUTE_LOGIN}/`) ||
    requestPath === "/server-login" ||
    requestPath === "/server-logout" ||
    requestPath.startsWith("/api/");

  if (!isMainPath || isPublicPath) {
    return next();
  }

  const cookieValue = req.cookies[AUTH_COOKIE_NAME];

  if (verifyCookie(cookieValue)) {
    return next();
  }

  return res.redirect(LOGIN_PATH);
});

// ----------------- Recommendation cache -----------------
//
// The full recommendation pipeline (Google Sheets fetch + weather +
// AI ranking + per-item AI bubble text) takes a few seconds.
// We cache the result so the screen loads instantly and AI calls only
// happen ~once every CACHE_TTL_MS in the background.

const RECOMMENDATION_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const RECOMMENDATION_CACHE_FILE = path.join(
  __dirname,
  ".recommendation-cache.json",
);
let recommendationCache = null; // { payload, timestamp }
let recommendationRefreshing = null; // in-flight refresh promise (dedupe)

function looksLikeFallbackOnly(payload) {
  // Detect a cache file whose recommendationText is mostly the
  // hard-coded "Try our X" fallback — i.e. a cache written when AI failed.
  const items = payload?.recommendations;
  if (!Array.isArray(items) || !items.length) return false;
  const fallbackCount = items.filter((it) => {
    const t = String(it?.recommendationText || "").trim();
    return t === `Try our ${it?.productName}` || !t;
  }).length;
  return fallbackCount / items.length >= 0.5;
}

function loadRecommendationCacheFromDisk() {
  try {
    if (!fs.existsSync(RECOMMENDATION_CACHE_FILE)) return;
    const text = fs.readFileSync(RECOMMENDATION_CACHE_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (parsed?.payload && typeof parsed.timestamp === "number") {
      if (looksLikeFallbackOnly(parsed.payload)) {
        console.warn(
          "Disk cache looks like fallback-only ('Try our X') — discarding so a fresh AI build runs",
        );
        try {
          fs.unlinkSync(RECOMMENDATION_CACHE_FILE);
        } catch {
          /* ignore */
        }
        return;
      }
      recommendationCache = parsed;
      const ageSec = Math.round((Date.now() - parsed.timestamp) / 1000);
      console.log(`Loaded recommendation cache from disk (age: ${ageSec}s)`);
    }
  } catch (error) {
    console.warn("Failed to load cache from disk:", error.message);
  }
}

async function saveRecommendationCacheToDisk() {
  if (!recommendationCache) return;
  try {
    await fsp.writeFile(
      RECOMMENDATION_CACHE_FILE,
      JSON.stringify(recommendationCache),
      "utf8",
    );
  } catch (error) {
    console.warn("Failed to save cache to disk:", error.message);
  }
}

async function buildRecommendationPayload() {
  if (!GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY");
  }

  if (!BRU_FOOD_SHEET_ID) {
    throw new Error("Missing BRU_FOOD_SHEET_ID");
  }

  const weather = await getCurrentWeather();

  const rows = await fetchSheetRange(
    BRU_FOOD_SHEET_ID,
    "Food Recommendations!A:Z",
  );

  if (rows.length < 2) {
    throw new Error("Food Recommendations sheet is empty");
  }

  const allItems = parseFoodSheet(rows);

  if (!allItems.length) {
    throw new Error("No food items found in sheet");
  }

  // The "Recommended" column is now OUTPUT-only — written back to the
  // sheet by the Apps Script after this build. The decision of whether
  // an item is recommended right now is driven entirely by its
  // "Recommendation Condition" cell vs the current weather.
  //
  // Items whose condition matches → included → marked "Yes" in the sheet.
  // Items whose condition doesn't match → excluded → marked "No".
  // Items with a blank condition → always match (always Yes).
  const matched = allItems.filter((item) =>
    evaluateCondition(item.condition, weather),
  );

  const ranked = await rankFoodItemsWithAI({ weather, items: matched });

  const weatherLabel = getWeatherLabel(
    weather.weather_code,
    weather.precipitation,
  );

  const aiTexts = await generateRecommendationTexts({
    weather,
    items: ranked,
  });

  const recommendations = ranked.map((item) => ({
    productName: item.productName,
    productDescription: item.productDescription,
    recommendationText:
      aiTexts.get(item.productName) ||
      item.recommendationText ||
      item.productDescription ||
      `Try our ${item.productName}`,
    condition: item.condition,
    imageUrl: item.url,
    reason: buildReasonString(item, weather),
  }));

  return {
    recommendations,
    weather: {
      temperatureC: weather.temperature_2m,
      precipitation: weather.precipitation,
      weatherCode: weather.weather_code,
      weatherLabel,
      isDay: weather.is_day,
    },
    selectedFood: recommendations[0]?.productName || "",
    selectedImage: recommendations[0]?.imageUrl || "",
    message: recommendations[0]
      ? `Today's Bru recommendation: ${recommendations[0].productName}`
      : "",
  };
}

// Push the new recommendation set to the Apps Script that owns the
// Bru food sheets. The script is responsible for two writes:
//   1. Food Recommendations sheet — reset every row's "Recommended" cell
//      to "No", then set "Yes" for each product in `recommendations` and
//      append the new AI text into that row's "Recommendation Text" cell.
//   2. Recommendation Log sheet — append ONE new row per recommended item
//      (per refresh) containing the AI-generated recommendation text +
//      timestamp. (Replaces the previous "increment counter on same row"
//      behaviour.)
//
// The Apps Script should branch on the `action` field; the legacy
// `productName/reason/recommendationTime` per-impression shape is no
// longer sent from the frontend.
async function notifyRecommendationRefresh(payload) {
  const RECOMMENDATION_LOG_SCRIPT_URL =
    process.env.RECOMMENDATION_LOG_SCRIPT_URL;

  if (!RECOMMENDATION_LOG_SCRIPT_URL) {
    console.warn(
      "RECOMMENDATION_LOG_SCRIPT_URL not configured; skipping sheet update",
    );
    return;
  }

  const recommendations = Array.isArray(payload?.recommendations)
    ? payload.recommendations
        .map((r) => ({
          productName: String(r?.productName || "").trim(),
          recommendationText: String(r?.recommendationText || "").trim(),
          reason: String(r?.reason || "").trim(),
        }))
        .filter((r) => r.productName)
    : [];

  // Notify even with an empty list — the Apps Script uses every refresh
  // as a cue to reset "Recommended" to "No" across the sheet before
  // marking the new matches "Yes". Skipping when empty would leave stale
  // "Yes" rows from the previous refresh.
  try {
    const upstreamRes = await fetch(RECOMMENDATION_LOG_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refresh",
        recommendations,
        // 24-hour Europe/London "YYYY-MM-DD HH:MM:SS" — written verbatim
        // into the Recommendation Log sheet's Recommendation Time column.
        recommendationTime: format24HourLondon(),
      }),
    });

    const text = await upstreamRes.text();
    if (!upstreamRes.ok) {
      console.error(
        `[sheet update] Apps Script returned ${upstreamRes.status}: ${text.slice(0, 300)}`,
      );
    } else {
      console.log(
        `[sheet update] Notified Apps Script of ${recommendations.length} recommendations`,
      );
    }
  } catch (error) {
    console.error("[sheet update] notify failed:", error.message);
  }
}

function refreshRecommendationsInBackground() {
  if (recommendationRefreshing) return recommendationRefreshing;

  recommendationRefreshing = (async () => {
    try {
      const payload = await buildRecommendationPayload();
      recommendationCache = { payload, timestamp: Date.now() };
      console.log("Recommendation cache refreshed");
      // Persist so the next server restart can serve instantly
      saveRecommendationCacheToDisk();
      // Fire-and-forget: tell the Apps Script to update the Food
      // Recommendations sheet (Recommended Yes/No + append text) and
      // append a new row in the Recommendation Log sheet for each item.
      // Don't await — sheet writes shouldn't block the cache update.
      notifyRecommendationRefresh(payload).catch((err) =>
        console.error("notifyRecommendationRefresh threw:", err),
      );
    } catch (error) {
      console.error("Recommendation refresh failed:", error.message);
    } finally {
      recommendationRefreshing = null;
    }
  })();

  return recommendationRefreshing;
}

async function getRecommendationsFromCache() {
  const now = Date.now();

  // Fresh cache → return immediately
  if (
    recommendationCache &&
    now - recommendationCache.timestamp < RECOMMENDATION_CACHE_TTL_MS
  ) {
    return recommendationCache.payload;
  }

  // Stale cache → return stale & refresh in background (stale-while-revalidate)
  if (recommendationCache) {
    refreshRecommendationsInBackground();
    return recommendationCache.payload;
  }

  // No cache yet → block until first fetch completes
  await refreshRecommendationsInBackground();

  if (recommendationCache) {
    return recommendationCache.payload;
  }

  throw new Error("Recommendation unavailable");
}

// Hydrate cache from disk synchronously at startup so the very first
// request after restart is instant (using whatever was saved last run).
// A background refresh kicks off immediately to bring it up to date.
loadRecommendationCacheFromDisk();
refreshRecommendationsInBackground();

// Periodic refresh so cache never goes stale during normal operation
setInterval(refreshRecommendationsInBackground, RECOMMENDATION_CACHE_TTL_MS);

// API: Bru recommendation (served from cache)
app.get("/api/recommendation", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const payload = await getRecommendationsFromCache();
    return res.json(payload);
  } catch (error) {
    console.error("recommendation error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// API: Force a fresh recommendation rebuild (clears in-memory and disk cache).
// Useful for debugging — e.g. when AI text is stuck on "Try our X" fallback.
app.post("/api/refresh-recommendations", async (req, res) => {
  try {
    recommendationCache = null;
    try {
      if (fs.existsSync(RECOMMENDATION_CACHE_FILE)) {
        fs.unlinkSync(RECOMMENDATION_CACHE_FILE);
      }
    } catch (err) {
      console.warn("Could not delete cache file:", err.message);
    }

    await refreshRecommendationsInBackground();

    const aiTextCount = recommendationCache?.payload?.recommendations?.filter(
      (it) => {
        const t = String(it?.recommendationText || "").trim();
        return t && t !== `Try our ${it?.productName}`;
      },
    ).length;

    return res.json({
      success: true,
      itemsWithAiText: aiTextCount ?? 0,
      totalItems: recommendationCache?.payload?.recommendations?.length ?? 0,
    });
  } catch (error) {
    console.error("refresh-recommendations error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// API: Log a recommendation impression  (DEPRECATED)
//
// Previously called on every frontend impression to bump a per-item
// "times recommended" counter in the Recommendation Log sheet. The
// frontend no longer calls this — sheet writes are now driven by the
// server-side cache refresh (see notifyRecommendationRefresh()), so
// each AI refresh appends a fresh row containing the recommendation
// text rather than incrementing a counter.
//
// Kept as a no-op so any stale browser tabs still serving the previous
// frontend bundle don't see 404s in the console.
app.post("/api/log-recommendation", async (req, res) => {
  return res.json({ success: true, deprecated: true });
});

// API: Quotes only
app.get("/api/sheets", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const type = req.query.type;

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: "Missing GOOGLE_API_KEY" });
    }

    if (type === "quotes") {
      if (!QUOTE_SHEET_ID) {
        return res.status(500).json({ error: "Missing QUOTE_SHEET_ID" });
      }

      const rows = await fetchSheetRange(QUOTE_SHEET_ID, "Quotes!A:H");

      if (rows.length < 2) {
        return res.json([]);
      }

      const headers = rows[0].map((h) => String(h || "").trim());

      const timestampIndex = headers.indexOf("Timestamp");
      const displayNameIndex = headers.indexOf("Display Name");
      const filteredIndex = headers.indexOf("Filtered Message");
      const statusIndex = headers.indexOf("Status");

      const quotes = rows
        .slice(1)
        .map((row, index) => {
          const rawTime = String(row[timestampIndex] || "").trim();
          const timeMs = parseSheetDate(rawTime);

          return {
            id: index + 1,
            timeMs,
            displayName: String(row[displayNameIndex] || "").trim(),
            quote: String(row[filteredIndex] || "").trim(),
            status:
              statusIndex !== -1 && row.length > statusIndex
                ? String(row[statusIndex] || "")
                    .trim()
                    .toLowerCase()
                : "approved",
          };
        })
        .filter((q) => q.quote)
        .filter((q) => q.status === "approved")
        .filter((q) => isMessageSafe(q.quote) && isMessageSafe(q.displayName))
        .filter((q) => !Number.isNaN(q.timeMs))
        .filter((q) => q.timeMs >= Date.now() - 60 * 60 * 1000)
        .sort((a, b) => b.timeMs - a.timeMs);

      return res.json(quotes);
    }

    return res.status(400).json({
      error: "Invalid type. Only type=quotes is supported for Bru Café.",
    });
  } catch (err) {
    console.error("api/sheets error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// API: QR quote submission
app.post("/api/submit-quote", async (req, res) => {
  try {
    const body = req.body || null;

    if (!body) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
      });
    }

    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim();
    const quote = String(body.quote || "").trim();

    const publicDisplayConsent = Boolean(body.publicDisplayConsent);
    const marketingConsent = Boolean(body.marketingConsent);

    if (!publicDisplayConsent) {
      return res.status(400).json({
        success: false,
        error: "Public display consent is required.",
      });
    }

    if (!displayName || !email || !quote) {
      return res.status(400).json({
        success: false,
        error: "Display name, email, and message are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid email address.",
      });
    }

    if (!isMessageSafe(displayName) || !isMessageSafe(quote)) {
      return res.status(400).json({
        success: false,
        error: "This message is against our policy.",
      });
    }

    const aiNameSafe = await isAiMessageSafe(displayName);
    const aiQuoteSafe = await isAiMessageSafe(quote);
    const llmResult = await moderateMessage(quote);

    const filteredQuote = llmResult.filtered;
    const llmStatus = llmResult.status;

    let status = "approved";
    let reason = "";

    if (aiNameSafe === false || aiQuoteSafe === false) {
      status = "rejected";
      reason = "ai_rejected";
    }

    if (aiNameSafe === "unknown" || aiQuoteSafe === "unknown") {
      status = "pending";
      reason = "ai_unknown";
    }

    if (llmStatus === "rejected") {
      status = "rejected";
      reason = "llm_rejected";
    }

    if (llmStatus === "unknown") {
      status = "pending";
      reason = "llm_unknown";
    }

    if (!QUOTE_SCRIPT_URL) {
      return res.status(500).json({
        success: false,
        error: "Missing QUOTE_SCRIPT_URL",
      });
    }

    const upstreamRes = await fetch(QUOTE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName,
        email,
        originalMessage: quote,
        filteredMessage: status === "approved" ? filteredQuote : "",
        status,
        reason,
        marketingConsent,
      }),
    });

    const text = await upstreamRes.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        success: upstreamRes.ok,
        raw: text,
      };
    }

    if (!upstreamRes.ok || data.success === false) {
      return res.status(500).json({
        success: false,
        error: data.error || "Failed to submit quote to Apps Script",
        details: data,
      });
    }

    if (status === "rejected") {
      return res.status(400).json({
        success: false,
        error: "This message is against our policy.",
      });
    }

    if (status === "pending") {
      return res.json({
        success: true,
        message: "Your message has been submitted for review.",
      });
    }

    return res.json({
      success: true,
      message: "Thank you! Your message has been submitted.",
    });
  } catch (error) {
    console.error("submit-quote error:", error);

    return res.status(500).json({
      success: false,
      error: "Moderation check failed. Please try again.",
    });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bru Café server running on port ${PORT}`);
});
