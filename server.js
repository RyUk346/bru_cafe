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
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";
// Google Maps "data_id" for the reviews widget (the 0x...:0x... hex that
// identifies the place). Defaults to Bru Coffee & Gelato Oadby; override via
// GOOGLE_PLACE_ID in .env.
const GOOGLE_PLACE_ID =
  process.env.GOOGLE_PLACE_ID || "0x487765125658a20b:0x6d1b077817c1ddd3";

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

// Per-character normalization only — does NOT strip non-alphanumeric
// characters. We need spaces/punctuation preserved as token separators
// so short banned words ("bs", "mf", ...) can be matched as whole
// tokens rather than as substrings of innocent words like "absolute"
// or "comfort".
function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o");
}

function collapseRepeats(text = "") {
  return text.replace(/(.)\1+/g, "$1");
}

const WHOLE_WORD_THRESHOLD = 5;

function tokenizeMessage(text = "") {
  const normalized = normalizeText(text);
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .map((t) => collapseRepeats(t))
    .filter(Boolean);
  const glued = collapseRepeats(tokens.join(""));
  return { tokens, glued };
}

function isMessageSafe(text = "") {
  const { tokens, glued } = tokenizeMessage(text);
  return !bannedWords.some((word) => {
    const target = collapseRepeats(
      normalizeText(word).replace(/[^a-z0-9]/g, ""),
    );
    if (!target) return false;
    // Short banned words must match a whole token; long ones still
    // match as substrings to catch disguised profanity.
    if (target.length < WHOLE_WORD_THRESHOLD) {
      return tokens.includes(target);
    }
    return glued.includes(target);
  });
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
//
// PROVIDER 1 (primary): met.no — the Norwegian Met Institute API (powers
//   Yr). Free, no key, licensed for COMMERCIAL use (CC-BY). This is what
//   fixes the café screen: Open-Meteo's free tier is non-commercial only
//   and was 502'ing / blocking us.
// PROVIDER 2 (fallback): Open-Meteo — used automatically if met.no fails.
//   If OPEN_METEO_API_KEY is set, the paid/commercial host is used.
//
// Both providers are normalised into the SAME shape Open-Meteo returns, so
// every downstream consumer (getWeatherLabel, getSkyState, the frontend
// widget) stays provider-agnostic and unchanged.

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || "";
const OPEN_METEO_HOST = OPEN_METEO_API_KEY
  ? "https://customer-api.open-meteo.com"
  : "https://api.open-meteo.com";
const OPEN_METEO_KEY_PARAM = OPEN_METEO_API_KEY
  ? `&apikey=${OPEN_METEO_API_KEY}`
  : "";

// met.no REQUIRES an identifying User-Agent with contact info, or it
// returns 403. (Also polite for Open-Meteo.)
const WEATHER_HEADERS = {
  "User-Agent":
    "BruCafeScreen/1.0 hello@hyperglow.co.uk (+https://hyperglow.co.uk)",
  Accept: "application/json",
};

// Café coordinates. Widget + recommendation historically used slightly
// different points; kept separate to preserve behaviour.
const WIDGET_WEATHER_LAT = Number(process.env.VITE_WEATHER_LAT) || 52.5976;
const WIDGET_WEATHER_LON = Number(process.env.VITE_WEATHER_LON) || -1.0833;
const RECOMMENDATION_LAT = 52.6369;
const RECOMMENDATION_LON = -1.1398;

const MS_TO_MPH = 2.236936;

// met.no uses text symbol_codes; our downstream code speaks numeric WMO
// codes (as Open-Meteo returns). Translate to the nearest WMO code.
function metnoSymbolToWmo(symbol = "") {
  const s = String(symbol)
    .replace(/_(day|night|polartwilight)$/, "")
    .toLowerCase();
  if (s === "clearsky") return 0;
  if (s === "fair") return 1;
  if (s === "partlycloudy") return 2;
  if (s === "cloudy") return 3;
  if (s === "fog") return 45;
  if (/^lightrain(showers)?$/.test(s)) return 61; // light rain / drizzle band
  if (s.includes("sleet")) return 66; // freezing-rain band
  if (s.includes("snow")) return 73;
  if (s.includes("thunder")) return 95;
  if (s.includes("rain")) return 63; // any remaining rain
  return 3; // safe default: cloudy
}

function metnoIsDay(symbol = "") {
  return /_night$/.test(symbol) ? 0 : 1;
}

// Fetch met.no and normalise to Open-Meteo's shape.
async function fetchFromMetNo(lat, lon) {
  const fRes = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
    { headers: WEATHER_HEADERS },
  );
  if (!fRes.ok) throw new Error(`met.no forecast failed: ${fRes.status}`);
  const fData = await fRes.json();

  const series = fData?.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) {
    throw new Error("met.no forecast: empty timeseries");
  }

  const now = series[0];
  const instant = now?.data?.instant?.details || {};
  const nextHour = now?.data?.next_1_hours || now?.data?.next_6_hours || {};
  const symbol = nextHour?.summary?.symbol_code || "";
  const curTemp = Number(instant.air_temperature);

  // "Today" in Europe/London, plus the live UTC offset (defined later in
  // this file — function declarations are hoisted, and these only run at
  // request time).
  const lnow = getLondonNow();
  const pad = (n) => String(n).padStart(2, "0");
  const todayLondon = `${lnow.getFullYear()}-${pad(lnow.getMonth() + 1)}-${pad(lnow.getDate())}`;
  const offset = getLondonOffset();

  // Daily max/min derived from the hourly series for today (London date).
  const temps = series
    .filter(
      (e) =>
        new Date(e.time)
          .toLocaleString("sv-SE", { timeZone: "Europe/London" })
          .slice(0, 10) === todayLondon,
    )
    .map((e) => Number(e?.data?.instant?.details?.air_temperature))
    .filter((n) => Number.isFinite(n));
  const tMax = temps.length ? Math.max(...temps) : curTemp;
  const tMin = temps.length ? Math.min(...temps) : curTemp;

  // Sunrise / sunset (separate met.no endpoint).
  const sRes = await fetch(
    `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${lat}&lon=${lon}` +
      `&date=${todayLondon}&offset=${encodeURIComponent(offset)}`,
    { headers: WEATHER_HEADERS },
  );
  if (!sRes.ok) throw new Error(`met.no sunrise failed: ${sRes.status}`);
  const sData = await sRes.json();
  const sunrise = sData?.properties?.sunrise?.time;
  const sunset = sData?.properties?.sunset?.time;
  if (!sunrise || !sunset) throw new Error("met.no sunrise: missing times");

  return {
    source: "met.no",
    current: {
      temperature_2m: curTemp,
      weather_code: metnoSymbolToWmo(symbol),
      is_day: metnoIsDay(symbol),
      precipitation: Number(nextHour?.details?.precipitation_amount ?? 0),
      relative_humidity_2m: Number(instant.relative_humidity ?? 0),
      wind_speed_10m: Number(instant.wind_speed ?? 0) * MS_TO_MPH, // m/s -> mph
    },
    daily: {
      sunrise: [sunrise],
      sunset: [sunset],
      temperature_2m_max: [tMax],
      temperature_2m_min: [tMin],
    },
  };
}

// Open-Meteo fallback, normalised to the same shape. One call returns both
// the rich `current` (recommendations) and `daily` (widget).
async function fetchFromOpenMeteo(lat, lon) {
  const url =
    `${OPEN_METEO_HOST}/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    `&current=temperature_2m,precipitation,weather_code,is_day,relative_humidity_2m,wind_speed_10m` +
    `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min` +
    `&wind_speed_unit=mph` +
    `&timezone=auto` +
    OPEN_METEO_KEY_PARAM;
  const res = await fetch(url, { headers: WEATHER_HEADERS });
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const data = await res.json();
  if (!data?.current) throw new Error("Open-Meteo: missing current");
  return {
    source: "open-meteo",
    current: data.current,
    daily: data.daily || {},
  };
}

// Provider chain: met.no first, Open-Meteo as automatic fallback. Retries
// once per provider to ride out transient blips.
async function fetchWeatherNormalised(lat, lon) {
  const providers = [
    () => fetchFromMetNo(lat, lon),
    () => fetchFromOpenMeteo(lat, lon),
  ];
  let lastErr;
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await provider();
      } catch (err) {
        lastErr = err;
        console.warn(
          `[weather] provider attempt ${attempt} failed:`,
          err.message,
        );
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  throw lastErr;
}

async function getCurrentWeather() {
  const normalised = await fetchWeatherNormalised(
    RECOMMENDATION_LAT,
    RECOMMENDATION_LON,
  );
  return normalised.current;
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

  // New column order (per PDF / updated sheet):
  //   A: Product Name
  //   B: Product Type        (NEW — drink / food / dessert etc.)
  //   C: Product Description
  //   D: Recommendation Condition
  //   E: Recommended         (output, written by Apps Script)
  //   F: Recommendation Text (output, written by Apps Script)
  //   G: Url
  const nameIdx = findHeaderIndex(headers, ["Product Name", "Name"]);
  const typeIdx = findHeaderIndex(headers, [
    "Product Type",
    "Type",
    "Category",
  ]);
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
      productType: typeIdx !== -1 ? String(row[typeIdx] || "").trim() : "",
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

// ----------------- PDF-spec helpers (state vocabulary) -----------------
//
// All of these compute deterministically in the backend BEFORE the OpenAI
// call, exactly as described in section 2 of the developer handover PDF.
// The LLM stays focused on filtering + ranking — never on time/season math.

function getLondonNow() {
  // A Date whose getHours/getDay/etc. all reflect Europe/London local time,
  // regardless of what timezone the host server runs in. We do this by
  // formatting the current instant in en-GB ISO-ish parts, then re-parsing.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return new Date(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "00" : map.hour),
    Number(map.minute),
    Number(map.second),
  );
}

// Returns a string offset like "+01:00" or "+00:00" for Europe/London now.
function getLondonOffset() {
  const offsetPart =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = offsetPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!m) return "+00:00";
  const sign = m[1].startsWith("-") ? "-" : "+";
  const hh = String(Math.abs(Number(m[1]))).padStart(2, "0");
  const mm = m[2] || "00";
  return `${sign}${hh}:${mm}`;
}

function getDayOfWeek(date) {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][date.getDay()];
}

function getSeason(date) {
  // UK meteorological seasons.
  const m = date.getMonth() + 1; // 1-12
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  if (m >= 9 && m <= 11) return "Autumn";
  return "Winter";
}

function getBehaviourToken(date) {
  const dow = getDayOfWeek(date);
  const isWeekend = dow === "Saturday" || dow === "Sunday";
  const minutes = date.getHours() * 60 + date.getMinutes();

  // Mon-Fri 06:30-09:30 — weekday-morning-rush
  if (!isWeekend && minutes >= 6 * 60 + 30 && minutes <= 9 * 60 + 30) {
    return "weekday-morning-rush";
  }
  // Sat-Sun 09:00-12:30 — weekend-brunch
  if (isWeekend && minutes >= 9 * 60 && minutes <= 12 * 60 + 30) {
    return "weekend-brunch";
  }
  // Mon-Fri 14:30-16:30 — school-run
  if (!isWeekend && minutes >= 14 * 60 + 30 && minutes <= 16 * 60 + 30) {
    return "school-run";
  }
  // Mon-Fri 16:30-19:00 — after-work
  if (!isWeekend && minutes > 16 * 60 + 30 && minutes <= 19 * 60) {
    return "after-work";
  }
  // Daily 21:00 and later — late-night
  if (minutes >= 21 * 60) {
    return "late-night";
  }
  return "none";
}

function getSkyState(weatherCode, precipitation = 0) {
  // PDF vocabulary: sunny | partly-cloudy | overcast | rainy
  if (
    precipitation > 0 ||
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)
  ) {
    return "rainy";
  }
  if (weatherCode === 0) return "sunny";
  if ([1, 2].includes(weatherCode)) return "partly-cloudy";
  if ([3, 45, 48].includes(weatherCode)) return "overcast";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "rainy"; // snow → treat as rainy band
  if ([95, 96, 99].includes(weatherCode)) return "rainy";
  return "overcast";
}

// PDF section 5 — state hash for cache short-circuit.
function buildStateHash(state) {
  return [
    Math.round(Number(state.weather.temperature_c) / 2) * 2, // 2°C bucket
    state.weather.sky,
    String(state.local_time).slice(0, 2), // hour bucket
    state.day_of_week,
    state.season,
    state.behaviour_token,
  ].join("|");
}

function buildCurrentState(weather) {
  const now = getLondonNow();
  const offset = getLondonOffset();
  const pad = (n) => String(n).padStart(2, "0");
  const localTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const isoLocal =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    offset;

  const sky = getSkyState(weather.weather_code, weather.precipitation);

  return {
    timestamp: isoLocal,
    local_time: localTime,
    day_of_week: getDayOfWeek(now),
    season: getSeason(now),
    behaviour_token: getBehaviourToken(now),
    weather: {
      temperature_c: Math.round(Number(weather.temperature_2m)),
      sky,
      // PDF section 2 — humidity/wind are reserved for future use but we
      // pass them through now so the rule sheet can start referencing them
      // without another backend deploy.
      humidity_pct: Math.round(
        Number(weather.relative_humidity_2m ?? weather.humidity_pct ?? 0),
      ),
      wind_mph: Math.round(
        Number(weather.wind_speed_10m ?? weather.wind_mph ?? 0),
      ),
    },
  };
}

// ----------------- The PDF system prompt (sent verbatim) -----------------

const RECOMMENDATION_SYSTEM_PROMPT = `You are the menu recommendation engine for Bru Oadby, a UK café and dessert shop in Leicestershire. Every 15 minutes you select 2-3 menu items to display on an in-store public screen, based on live weather, time, and customer behaviour signals.

You will receive:
1. CURRENT STATE — timestamp, local time, day of week, season, behaviour_token (one of: weekday-morning-rush, weekend-brunch, school-run, after-work, late-night, post-workout, none), and weather (temperature_c, sky one of sunny/partly-cloudy/overcast/rainy, humidity_pct, wind_mph).
2. MENU — an array of items, each with product_name, product_type, product_description, and recommendation_condition (a natural-English rule describing when to recommend it).

YOUR PROCESS:
Step 1 — FILTER. For each menu item, evaluate whether its recommendation_condition is satisfied by the CURRENT STATE. Conditions reference temperature bands, sky states, time-of-day windows, day-of-week, season, and behaviour tokens in plain English. Some conditions also include "Do NOT recommend" clauses — respect those exclusions.

Step 2 — SCORE each qualifying item on a 0-10 scale:
 a) Centrality: how centrally the current temperature, time and sky sit inside the item's stated sweet-spot band (centre = higher).
 b) Behaviour match: if the item's condition explicitly references the current behaviour_token, add 2 points.
 c) Seasonal alignment: in-season = +1.
 d) Day-part typicality: the product is being shown in its primary day-part (breakfast item in the morning, dessert in the evening, etc.) = +1.

Step 3 — SELECT exactly 3 or 4 items, applying these tie-breakers in order:
 1. Highest score wins.
 2. Category diversity: when top scores are within 1 point of each other, mix product_types (one drink, one food, one dessert) before duplicating a category.
 3. Prefer signature/POPULAR items when scores tie: Spanish Rose Latte, Pistachio Latte, Strawbella shakes, Korean Tenders, Hot Dubai Chocolate Brownie, San Sebastian Cheesecake.
 4. Sort the final array by score descending (rank 1 = highest).

EDGE CASES:
- If 0 items qualify after Step 1, relax the rules slightly: pick the 3 items whose conditions are closest to the current state (smallest distance from temperature band, sky, or time window).
- If exactly 1 item qualifies, return that item plus the next-closest near-miss.
- If 5+ items would otherwise tie at the top, prefer category diversity, then signature items.

OUTPUT — return strict JSON only. No markdown fences, no preamble, no commentary.
{
  "evaluated_at": "<ISO 8601 timestamp from input>",
  "state_summary": "<one short sentence describing the live state>",
  "selected": [
    {
      "rank": 1,
      "product_name": "<exact product_name from menu — never invent>",
      "recommend": "Yes",
      "recommendation_text": "<customer-facing copy, max 14 words, references the current moment (weather, time, behaviour). No emojis, no hashtags, no exclamation marks.>",
      "score": <0-10 number>,
      "reasoning": "<one short internal sentence — why this item right now>"
    }
  ]
}

RULES:
- selected array length MUST be 3 or 4.
- Never invent products not in the supplied MENU.
- Never include items with "recommend": "No" — the public screen only shows winners.
- recommendation_text must feel written for THIS moment, not a generic slogan. Reference the rain, the sunshine, the morning rush, the school-run, the cold evening, etc.
- recommendation_text MUST be real customer-facing copy for EVERY selected item, including items picked via the edge-case "relax the rules" path. The line is shown to paying customers on a public screen — it must always sound like a friendly invitation to try the item.
- FORBIDDEN phrases in recommendation_text — DO NOT WRITE these or anything similar, even when the fit is partial:
    "N/A", "None", "TBD", "--",
    "No recommendation",
    "Not recommended",
    "Cannot recommend",
    "Unable to recommend",
    "We don't recommend",
    "Skip this item",
    or any other refusal, disclaimer, or apology about the recommendation itself.
- If an item's fit is weak, write copy that describes the item's flavour, texture, indulgence, or warmth/coolness instead — never write copy that says you can't recommend it. Example: instead of "Not recommended on a hot day", write "A rich classic worth a try whatever the weather".
- If you truly cannot write a positive line for an item, DROP it from the selected array and pick a different item. NEVER include an item with a refusal line.

EXAMPLES OF GOOD recommendation_text:
- Warming pistachio comfort for a grey autumn afternoon.
- Iced matcha to match the bright weekend sunshine.
- Hearty fuel before the cold Monday commute.
- Soft tres leches for a sticky summer evening.`;

// ----------------- Single-call recommendation -----------------

function wordCount(str) {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// Strings the LLM sometimes uses as a placeholder when it picked an
// item via the edge-case "relax the rules" path and didn't generate
// genuine customer-facing copy. We treat them as empty so the fallback
// chain in buildRecommendationPayload (productDescription → "Try our X")
// can substitute something usable.

// 1. Short tokens used as a whole reply: "N/A", "None", "TBD", "--", etc.
const PLACEHOLDER_EXACT_PATTERN =
  /^(n\.?\/?a\.?|none|null|undefined|tbd|tba|--+|\.{2,})$/i;

// 2. Refusal phrases — the model writes a longer sentence when it
//    can't think of customer-facing copy:
//      "No recommendation due to current weather conditions."
//      "Not recommended at this time."
//      "Cannot recommend this item right now."
//      "Unable to provide a recommendation."
//      "We don't recommend this for the current conditions."
//    The regex requires the literal word "recommend" / "recommendation"
//    to follow a negation, which avoids false positives like
//    "no frills latte" or "not too sweet".
const PLACEHOLDER_REFUSAL_PATTERN =
  /\b(no\s+recommendation|not\s+recommend(ed|ing|able)?|cannot\s+recommend|can'?t\s+recommend|unable\s+to\s+(?:recommend|provide\s+a\s+recommend)|do(?:es)?\s*n'?t\s+recommend|refrain\s+from\s+recommend|skip\s+this\s+(?:item|recommendation))\b/i;

function looksLikePlaceholder(text) {
  if (!text) return true;
  if (PLACEHOLDER_EXACT_PATTERN.test(text)) return true;
  if (PLACEHOLDER_REFUSAL_PATTERN.test(text)) return true;
  return false;
}

function sanitiseRecommendationText(text) {
  // Per PDF failure modes: strip emoji/exclamation marks before display,
  // do not retry just for these.
  const cleaned = String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // emoji ranges
    .replace(/!+/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  // If the LLM returned a placeholder ("N/A", "None") or a refusal
  // phrase ("No recommendation due to…"), treat it as if it returned
  // nothing — so the productDescription / "Try our X" fallback can
  // substitute something real before the row reaches the log sheet.
  if (looksLikePlaceholder(cleaned)) {
    console.warn(
      `[recommendation] placeholder/refusal text detected and dropped: "${cleaned}"`,
    );
    return "";
  }

  return cleaned;
}

async function callRecommendationLLM({ state, items, retryHint = null }) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const menu = items.map((i) => ({
    product_name: i.productName,
    product_type: i.productType || "uncategorised",
    product_description: i.productDescription,
    recommendation_condition: i.condition,
  }));

  const userPrompt =
    `CURRENT STATE:\n${JSON.stringify(state, null, 2)}\n\n` +
    `MENU:\n${JSON.stringify(menu, null, 2)}\n\n` +
    `Return your selection as JSON now.` +
    (retryHint ? `\n\n${retryHint}` : "");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RECOMMENDATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim() || "";
  return JSON.parse(raw);
}

function validateLlmResponse(parsed, items) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") {
    return ["response is not an object"];
  }
  const selected = parsed.selected;
  if (!Array.isArray(selected)) {
    return ["selected is not an array"];
  }
  // Match the count window declared in the system prompt above
  // (currently 3 or 4 picks per refresh).
  if (selected.length < 3 || selected.length > 4) {
    errors.push(`selected length ${selected.length} must be 3 or 4`);
  }

  const knownNames = new Set(items.map((i) => i.productName));
  for (const sel of selected) {
    if (!sel || typeof sel !== "object") {
      errors.push("selected entry is not an object");
      continue;
    }
    if (!knownNames.has(sel.product_name)) {
      errors.push(`hallucinated product_name: ${sel.product_name}`);
    }
    // NOTE: We deliberately DO NOT treat `recommend: "No"` as a hard error.
    // The PDF prompt tells the model "never include recommend=No in selected",
    // but in practice the model sometimes contradicts itself: it picks an
    // item as a winner (places it in `selected`) yet labels it `recommend: No`
    // because none of the rules strictly matched and it relaxed per the
    // edge-case clause. Membership of `selected` is the source of truth —
    // we normalise `recommend` to "Yes" downstream and log a warning.
    if (sel.recommend && String(sel.recommend).toLowerCase() === "no") {
      console.warn(
        `[recommendation] LLM put "${sel.product_name}" in selected but labelled recommend=No — accepting (selected wins) and normalising to Yes`,
      );
    }
    if (wordCount(sel.recommendation_text) > 14) {
      errors.push(
        `recommendation_text >14 words for ${sel.product_name}: "${sel.recommendation_text}"`,
      );
    }
  }
  return errors;
}

async function buildRecommendationsViaLLM({ state, items }) {
  // Try once, retry once with a corrective hint, then throw.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await callRecommendationLLM({
        state,
        items,
        retryHint:
          attempt === 2
            ? "Your previous response did not match the schema. Return valid JSON matching the schema. Try again."
            : null,
      });

      const errors = validateLlmResponse(parsed, items);
      if (errors.length) {
        console.warn(
          `[recommendation] LLM response validation failed (attempt ${attempt}):`,
          errors,
        );
        if (attempt < 2) continue;
        throw new Error(
          `LLM response invalid after retry: ${errors.join("; ")}`,
        );
      }

      return parsed;
    } catch (error) {
      console.error(
        `[recommendation] OpenAI call failed (attempt ${attempt}):`,
        error?.message || error,
      );
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw error;
    }
  }
  throw new Error("buildRecommendationsViaLLM: exhausted attempts");
}

// Structured reason string written to the Recommendation Log sheet.
// Format: deterministic, audit-friendly — shows the live state signals
// the LLM evaluated against:
//   • state_summary  — LLM's one-line description of the moment
//   • Type           — Product Type from the sheet (column B)
//   • Day            — day_of_week (Monday–Sunday)
//   • Season         — Spring / Summer / Autumn / Winter
//   • Temp           — temperature_c, °C
//   • Sky            — sunny / partly-cloudy / overcast / rainy
//   • Behaviour      — behaviour_token (weekday-morning-rush, etc.)
//
// The row's Recommendation Condition (column D) is intentionally NOT
// included — it's already in the sheet next to the row, so duplicating
// it in the log just wastes column space.
function buildReasonString(item, state, stateSummary = "") {
  const summary = stateSummary ? String(stateSummary).trim() : "";
  const type =
    item && item.productType ? String(item.productType).trim() : "(no type)";
  const day = state?.day_of_week || "unknown";
  const season = state?.season || "unknown";
  const tempC = Math.round(Number(state?.weather?.temperature_c ?? 0));
  const sky = state?.weather?.sky || "unknown";
  const behaviour = state?.behaviour_token || "none";

  const summaryPart = summary ? `${summary}  ` : "";

  return (
    `Type: ${type} | ` +
    `Day: ${day} | ` +
    `Season: ${season} | ` +
    `Temp: ${tempC}°C | ` +
    `Sky: ${sky} | ` +
    `Behaviour: ${behaviour} |` +
    `Summary: ${summaryPart}`
  );
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
      maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // ~10 years — effectively permanent
      path: "/",
    });

    return res.send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="1;url=${MAIN_PATH}" />
        </head>
        <body style="">
        
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

// PDF section 5 — refresh cadence is 15 minutes. The state-hash check
// below means most ticks reuse the previous response anyway.
const RECOMMENDATION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// PDF cost-optimisation: if the state hash hasn't changed AND the last
// successful call was within this window, skip the OpenAI call entirely.
const STATE_HASH_REUSE_MS = 2 * 60 * 60 * 1000; // 2 hours
const RECOMMENDATION_CACHE_FILE = path.join(
  __dirname,
  ".recommendation-cache.json",
);
let recommendationCache = null; // { payload, timestamp, stateHash }
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

  // PDF approach: send the full menu to the LLM with the live state.
  // The LLM filters, scores, and selects 2–3 items in a single call.
  // (No local pre-filter — natural-English conditions are too nuanced
  // for regex evaluation, and the LLM is cached aggressively.)
  const state = buildCurrentState(weather);
  const llmResponse = await buildRecommendationsViaLLM({
    state,
    items: allItems,
  });

  const itemsByName = new Map(allItems.map((i) => [i.productName, i]));

  const recommendations = (llmResponse.selected || [])
    .map((sel) => {
      const item = itemsByName.get(sel.product_name);
      if (!item) return null;
      // Fallback chain — each layer is run through the sanitiser so
      // refusal phrases that previously got written to the sheet
      // ("No recommendation due to current weather conditions.") can't
      // leak in from the persisted Recommendation Text column.
      const cleanText =
        sanitiseRecommendationText(sel.recommendation_text) ||
        sanitiseRecommendationText(item.recommendationText) ||
        item.productDescription ||
        `Try our ${item.productName}`;
      return {
        rank: Number(sel.rank) || 0,
        productName: item.productName,
        productType: item.productType,
        productDescription: item.productDescription,
        recommendationText: cleanText,
        condition: item.condition,
        imageUrl: item.url,
        score: Number(sel.score) || 0,
        // `reason` is what gets written to the Recommendation Log sheet's
        // Reason column. We assemble a deterministic structured string
        // from the LLM's `state_summary` + product type + day + season +
        // weather + sky + behaviour token. The row's Recommendation
        // Condition (column D) is intentionally omitted because the
        // sheet already shows it next to the row. The LLM's narrative
        // `reasoning` is preserved separately on `llmReasoning` if any
        // future log column wants it.
        reason: buildReasonString(item, state, llmResponse.state_summary),
        llmReasoning: sel.reasoning || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.rank || 99) - (b.rank || 99));

  const weatherLabel = getWeatherLabel(
    weather.weather_code,
    weather.precipitation,
  );

  return {
    evaluatedAt: llmResponse.evaluated_at || state.timestamp,
    stateSummary: llmResponse.state_summary || "",
    state,
    recommendations,
    weather: {
      temperatureC: weather.temperature_2m,
      precipitation: weather.precipitation,
      weatherCode: weather.weather_code,
      weatherLabel,
      isDay: weather.is_day,
      humidityPct: state.weather.humidity_pct,
      windMph: state.weather.wind_mph,
      sky: state.weather.sky,
    },
    behaviourToken: state.behaviour_token,
    // Backwards-compat fields the old frontend bundle still reads.
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
      // PDF section 5 short-circuit: if state-hash hasn't changed and we
      // have a recent successful response, just touch the timestamp and
      // skip the OpenAI call entirely.
      if (
        recommendationCache &&
        recommendationCache.stateHash &&
        Date.now() - recommendationCache.timestamp < STATE_HASH_REUSE_MS
      ) {
        try {
          const weather = await getCurrentWeather();
          const state = buildCurrentState(weather);
          const currentHash = buildStateHash(state);
          if (currentHash === recommendationCache.stateHash) {
            recommendationCache = {
              ...recommendationCache,
              timestamp: Date.now(),
            };
            console.log(
              `[recommendation] state hash unchanged (${currentHash}) — reusing cached response, skipped OpenAI call`,
            );
            saveRecommendationCacheToDisk();
            return;
          }
        } catch (err) {
          // If the cheap check fails, fall through to the full rebuild.
          console.warn(
            "[recommendation] state-hash short-circuit failed, doing full rebuild:",
            err.message,
          );
        }
      }

      const payload = await buildRecommendationPayload();
      const stateHash = payload.state ? buildStateHash(payload.state) : null;
      recommendationCache = {
        payload,
        timestamp: Date.now(),
        stateHash,
      };
      console.log(
        `Recommendation cache refreshed (state=${stateHash || "n/a"})`,
      );
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

// API: Weather (proxy for the screen's WeatherWidget)
//
// The in-store screen's browser is locked down to this origin and cannot
// reach external weather APIs directly (cross-origin request → "Failed to
// fetch"). The Node server fetches on its behalf via the provider chain
// (met.no primary, Open-Meteo fallback) so the browser only ever talks to
// its own origin. Response is cached briefly so polling from every screen
// doesn't hammer the upstream providers.
const WIDGET_WEATHER_TTL_MS = 5 * 60 * 1000; // 5 minutes
let widgetWeatherCache = null; // { data, timestamp }

app.get("/api/weather", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    if (
      widgetWeatherCache &&
      Date.now() - widgetWeatherCache.timestamp < WIDGET_WEATHER_TTL_MS
    ) {
      return res.json(widgetWeatherCache.data);
    }

    const data = await fetchWeatherNormalised(
      WIDGET_WEATHER_LAT,
      WIDGET_WEATHER_LON,
    );
    widgetWeatherCache = { data, timestamp: Date.now() };
    return res.json(data);
  } catch (error) {
    console.error("api/weather error:", error.message);
    // Serve stale cache rather than breaking the widget on a transient blip.
    if (widgetWeatherCache) {
      return res.json(widgetWeatherCache.data);
    }
    return res.status(502).json({ error: error.message });
  }
});

// API: Google reviews (proxy for the screen's GoogleReviews widget)
//
// Reads PUBLIC Google reviews via SerpApi's Google Maps Reviews engine (no
// Google Business Profile login required) and returns the latest 5-star
// reviews. Runs server-side so the SerpApi key stays secret and the
// locked-down screen browser only ever talks to its own origin.
//
// New reviews always land on PAGE 1 (newest-first), so each refresh only needs
// page 1 — we merge any new 5-star-with-text reviews into the kept list of 6.
// We page deeper ONLY to seed the list to 6 the first time (many recent Google
// reviews are star-only, so 6 with text can span several pages). After that
// it's one page per refresh.
//
// Free-tier budget (SerpApi free = 250 searches/month, no card):
//   • Auto refresh every 6h = 4 pulls/day × 1 page ≈ 120 searches/month.
//   • The frontend's hourly polling is served from the in-memory cache below,
//     so it never hits SerpApi.
//   • Refresh is 6h apart — beyond SerpApi's own ~1h cache window — so each
//     pull picks up newly-posted reviews automatically, no no_cache needed.
//   • A one-off deeper seed (≤4 pages) runs on first request / after a restart.
const GOOGLE_REVIEWS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GOOGLE_REVIEWS_MAX = 6; // 5-star reviews kept and shown
const GOOGLE_REVIEWS_SEED_PAGES = 4; // max pages when first seeding the list
let googleReviewsCache = null; // { data: { reviews }, timestamp }

async function fetchSerpReviewPage(pageToken = null, forceFresh = false) {
  const url =
    "https://serpapi.com/search.json?engine=google_maps_reviews" +
    `&data_id=${encodeURIComponent(GOOGLE_PLACE_ID)}` +
    "&sort_by=newestFirst&hl=en" +
    `&api_key=${encodeURIComponent(SERPAPI_API_KEY)}` +
    // Auto pulls are 6h apart (beyond SerpApi's cache) so they get fresh data
    // without no_cache. Only the manual endpoint forces a live scrape.
    (forceFresh ? "&no_cache=true" : "") +
    (pageToken ? `&next_page_token=${encodeURIComponent(pageToken)}` : "");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`SerpApi: ${json.error}`);
  return json;
}

// Keep only 5-star reviews that have written text (skip star-only ratings).
function extractFiveStarWithText(json) {
  const out = [];
  for (const r of json.reviews || []) {
    const rating = Number(r.rating) || 0;
    const text = (r.snippet || "").trim();
    if (rating !== 5 || !text) continue;
    out.push({
      id: r.review_id || r.link || null,
      name: r.user?.name || "Google user",
      avatarUrl: r.user?.thumbnail || "",
      text,
      rating,
      timestamp: r.iso_date ? Date.parse(r.iso_date) : 0,
    });
  }
  return out;
}

// Merge incoming into existing, de-dupe by id, keep the newest MAX.
function mergeReviews(existing, incoming) {
  const seen = new Map();
  for (const r of [...incoming, ...existing]) {
    const key = r.id || `${r.name}|${r.timestamp}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, GOOGLE_REVIEWS_MAX);
}

// Refresh the kept list: always read page 1 (catches new reviews), then page
// deeper only while we still don't have MAX (first-time seed).
async function refreshGoogleReviews(forceFresh = false) {
  const current = googleReviewsCache?.data?.reviews || [];

  let json = await fetchSerpReviewPage(null, forceFresh); // page 1 (newest)
  let merged = mergeReviews(current, extractFiveStarWithText(json));

  let pageToken = json.serpapi_pagination?.next_page_token || null;
  let page = 1;
  while (
    merged.length < GOOGLE_REVIEWS_MAX &&
    pageToken &&
    page < GOOGLE_REVIEWS_SEED_PAGES
  ) {
    json = await fetchSerpReviewPage(pageToken, forceFresh);
    merged = mergeReviews(merged, extractFiveStarWithText(json));
    pageToken = json.serpapi_pagination?.next_page_token || null;
    page += 1;
  }

  googleReviewsCache = { data: { reviews: merged }, timestamp: Date.now() };
  return merged;
}

app.get("/api/google-reviews", async (req, res) => {
  res.set("Cache-Control", "no-store");

  // No key configured yet — return an empty list so the widget just hides.
  if (!SERPAPI_API_KEY) {
    return res.json({ reviews: [] });
  }

  try {
    if (
      googleReviewsCache &&
      Date.now() - googleReviewsCache.timestamp < GOOGLE_REVIEWS_TTL_MS
    ) {
      return res.json(googleReviewsCache.data);
    }

    const reviews = await refreshGoogleReviews();
    return res.json({ reviews });
  } catch (error) {
    console.error("api/google-reviews error:", error.message);
    // Serve stale cache rather than breaking the widget on a transient blip.
    if (googleReviewsCache) {
      return res.json(googleReviewsCache.data);
    }
    return res.status(502).json({ reviews: [], error: error.message });
  }
});

// API: OPTIONAL manual refresh. With the 6h auto-refresh above, new reviews
// appear on their own within 6h — this endpoint is just a "show it right now"
// shortcut (e.g. straight after posting a review). It forces a fresh live
// scrape and merges any new reviews into the kept list. Open the URL in a
// browser; it reports how many 5-star reviews are currently shown.
app.get("/api/refresh-google-reviews", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!SERPAPI_API_KEY) {
    return res.status(400).json({ error: "SERPAPI_API_KEY is not set" });
  }

  try {
    const reviews = await refreshGoogleReviews(true); // force fresh scrape now
    return res.json({ success: true, count: reviews.length, reviews });
  } catch (error) {
    console.error("api/refresh-google-reviews error:", error.message);
    return res.status(502).json({ error: error.message });
  }
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

// Serve product images hosted on the VPS (same-origin = always loads on the
// locked-down screen). Nested category subfolders are served automatically,
// e.g. product-images/Hot items/Hot_Coffee-Americano.png
//   -> /bru_cafe/product-images/Hot%20items/Hot_Coffee-Americano.png
// NOTE: the mount path "/product-images" must match BOTH the URL you put in
// the sheet AND the folder name on disk (next to server.js).
app.use(
  "/product-images",
  express.static(path.join(__dirname, "product-images"), { maxAge: "7d" }),
);

// Serve frontend
app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bru Café server running on port ${PORT}`);
});
