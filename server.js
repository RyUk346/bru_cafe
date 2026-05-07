import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
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

// Paths
const AUTH_COOKIE_NAME = "hg_bru_screen_auth";

const MAIN_PATH = "/BruCafe/Screen";
const MESSAGE_PATH = "/BruCafe/Message";
const LOGIN_PATH = "/BruCafe/Login";

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

// Find a header column index by fuzzy match (case/space/typo tolerant)
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

  // partial match fallback
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

// Rule evaluator – parses simple natural language conditions and returns
// true if the current weather matches.
function evaluateCondition(condition, weather) {
  if (!condition) return true; // no condition -> always recommend

  const text = String(condition).toLowerCase();
  const tempC = Number(weather.temperature_2m);
  const precipitation = Number(weather.precipitation || 0);
  const weatherCode = Number(weather.weather_code);
  const isDay = Boolean(weather.is_day);

  let matchAll = true;

  // Temperature rules
  // "between A and B"
  const between = text.match(
    /temp\w*\s+between\s+(-?\d+(?:\.\d+)?)\s*(?:and|to|-)\s*(-?\d+(?:\.\d+)?)/,
  );
  if (between) {
    const low = Number(between[1]);
    const high = Number(between[2]);
    matchAll = matchAll && tempC >= low && tempC <= high;
  } else {
    // "above/over/greater than/more than N"
    const aboveMatch = text.match(
      /temp\w*\s+(?:above|over|greater than|more than|>=?|higher than)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (aboveMatch) {
      matchAll = matchAll && tempC > Number(aboveMatch[1]);
    }

    // "below/under/less than/lower than N"
    const belowMatch = text.match(
      /temp\w*\s+(?:below|under|less than|lower than|<=?)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (belowMatch) {
      matchAll = matchAll && tempC < Number(belowMatch[1]);
    }

    // "equals N" / "is N"
    const equalsMatch = text.match(
      /temp\w*\s+(?:equals?|is|=)\s+(-?\d+(?:\.\d+)?)/,
    );
    if (equalsMatch) {
      matchAll = matchAll && Math.round(tempC) === Number(equalsMatch[1]);
    }
  }

  // Weather state keywords (apply only if mentioned)
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

// Use AI to refine ranking among rule-matched items so the most relevant
// foods appear first in the rotation. Falls back gracefully without AI.
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
    // append any items the AI dropped
    for (const item of items) {
      if (!ordered.includes(item)) ordered.push(item);
    }

    return ordered;
  } catch (error) {
    console.error("AI ranking failed:", error.message);
    return items;
  }
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
    requestPath === MAIN_PATH || requestPath.startsWith(`${MAIN_PATH}/`);

  const isPublicPath =
    requestPath === MESSAGE_PATH ||
    requestPath.startsWith(`${MESSAGE_PATH}/`) ||
    requestPath === LOGIN_PATH ||
    requestPath.startsWith(`${LOGIN_PATH}/`) ||
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

// API: Bru recommendation - returns multiple items for rotation
app.get("/api/recommendation", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: "Missing GOOGLE_API_KEY" });
    }

    if (!BRU_FOOD_SHEET_ID) {
      return res.status(500).json({ error: "Missing BRU_FOOD_SHEET_ID" });
    }

    const weather = await getCurrentWeather();

    const rows = await fetchSheetRange(
      BRU_FOOD_SHEET_ID,
      "Food Recommendations!A:Z",
    );

    if (rows.length < 2) {
      return res.status(400).json({
        error: "Food Recommendations sheet is empty",
      });
    }

    const allItems = parseFoodSheet(rows);

    if (!allItems.length) {
      return res.status(400).json({
        error: "No food items found in sheet",
      });
    }

    // Step 1: Manual override flag - exclude items explicitly marked off
    const enabled = allItems.filter((item) => {
      const flag = item.recommendedFlag.toLowerCase();
      return (
        flag !== "no" && flag !== "false" && flag !== "0" && flag !== "off"
      );
    });

    // Step 2: Rule-based filter against the Recommendation Condition column
    let matched = enabled.filter((item) =>
      evaluateCondition(item.condition, weather),
    );

    // Step 3: If nothing matched, fall back to all enabled items
    if (!matched.length) {
      matched = enabled;
    }

    // Step 4: AI ranks the matched items by relevance
    const ranked = await rankFoodItemsWithAI({ weather, items: matched });

    const weatherLabel = getWeatherLabel(
      weather.weather_code,
      weather.precipitation,
    );

    const recommendations = ranked.map((item) => ({
      productName: item.productName,
      productDescription: item.productDescription,
      recommendationText:
        item.recommendationText ||
        item.productDescription ||
        `Try our ${item.productName}`,
      condition: item.condition,
      imageUrl: item.url,
      reason: buildReasonString(item, weather),
    }));

    return res.json({
      recommendations,
      weather: {
        temperatureC: weather.temperature_2m,
        precipitation: weather.precipitation,
        weatherCode: weather.weather_code,
        weatherLabel,
        isDay: weather.is_day,
      },
      // Backward-compatible top-level fields based on the first item
      selectedFood: recommendations[0]?.productName || "",
      selectedImage: recommendations[0]?.imageUrl || "",
      message: recommendations[0]
        ? `Today's Bru recommendation: ${recommendations[0].productName}`
        : "",
    });
  } catch (error) {
    console.error("recommendation error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// API: Log a recommendation impression (writes to Apps Script -> Recommendation Log tab)
app.post("/api/log-recommendation", async (req, res) => {
  try {
    const { productName, reason } = req.body || {};

    if (!productName || typeof productName !== "string") {
      return res.status(400).json({
        success: false,
        error: "productName is required",
      });
    }

    const RECOMMENDATION_LOG_SCRIPT_URL =
      process.env.RECOMMENDATION_LOG_SCRIPT_URL;

    if (!RECOMMENDATION_LOG_SCRIPT_URL) {
      // Soft-fail so the screen keeps running even if logging is not yet wired up
      console.warn(
        "RECOMMENDATION_LOG_SCRIPT_URL not configured; skipping log write",
      );
      return res.json({ success: true, skipped: true });
    }

    const recommendationTime = new Date().toISOString();

    const upstreamRes = await fetch(RECOMMENDATION_LOG_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: String(productName).trim(),
        reason: String(reason || "").trim(),
        recommendationTime,
      }),
    });

    const text = await upstreamRes.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: upstreamRes.ok, raw: text };
    }

    if (!upstreamRes.ok || data.success === false) {
      return res.status(500).json({
        success: false,
        error: data.error || "Failed to log recommendation",
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("log-recommendation error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Logging failed",
    });
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

// Serve frontend
app.use(express.static(path.join(__dirname, "dist")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Bru Café server running on port ${PORT}`);
});
