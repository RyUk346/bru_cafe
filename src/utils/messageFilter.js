// utils/moderation.js

// Per-character normalization: lowercase + collapse common leetspeak.
// Note: unlike the old version, we DO NOT strip non-alphanumeric chars
// here — they're needed as token separators so short banned words like
// "bs" or "mf" can be matched as whole words rather than substrings of
// innocent words ("absolute", "comfort", "audience", etc.).
function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[7]/g, "t");
}

function collapseRepeats(text = "") {
  return text.replace(/(.)\1+/g, "$1");
}

// Split the message into alphanumeric tokens (treating any non-alphanumeric
// character — spaces, punctuation, emoji — as a word separator), then
// collapse repeats per-token. Returns the list of tokens plus a single
// "glued" string of all tokens joined, which the old substring matcher
// still uses for disguised profanity like "f.u.c.k" → "fuck".
function tokenize(rawText = "") {
  const normalized = normalizeText(rawText);
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .map((t) => collapseRepeats(t))
    .filter(Boolean);
  const glued = collapseRepeats(tokens.join(""));
  return { tokens, glued };
}

// Banned words shorter than this length are matched as whole tokens only,
// to avoid false positives from substrings ("bs" inside "absolute",
// "mf" inside "comfort", "die" inside "audience"). Longer banned words
// stay substring-matchable so disguised profanity is still caught.
const WHOLE_WORD_THRESHOLD = 5;

const bannedWords = [
  // Core profanity
  "fuck",
  "fuk",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "arsehole",
  "cunt",
  "dick",
  "piss",
  "slut",
  "whore",

  // Strong slang / shortened abuse
  "mf",
  "mfer",
  "mofo",
  "motherfucker",
  "wtf",
  "stfu",
  "gtfo",
  "bullshit",
  "bs",
  "jackass",
  "douche",
  "douchebag",
  "prick",
  "twat",

  // UK abusive slang
  "wanker",
  "tosser",
  "bellend",
  "knobhead",
  "numpty",
  "git",
  "muppet",
  "plonker",
  "twit",

  // Aggressive insults
  "scumbag",
  "dumbass",
  "shithead",
  "dipshit",
  "fuckwit",
  "asshat",
  "cretin",
  "degenerate",

  // Negative personal attacks
  "idiot",
  "moron",
  "loser",
  "stupid",
  "trash",
  "garbage",
  "clown",
  "fool",
  "pathetic",
  "worthless",
  "useless",
  "disgusting",
  "failure",
  "freak",
  "weirdo",

  // Harmful phrases collapsed by normalization
  "killyourself",
  "kys",
  "die",
];

const bannedPatterns = [
  // Core profanity patterns
  /f+u*c+k+/,
  /f+u+k+/,
  /s+h+i*t+/,
  /b+i+t+c+h+/,
  /c+u+n+t+/,
  /d+i+c+k+/,
  /a+s+s+h+o+l+e+/,
  /a+r+s+e+h+o+l+e+/,
  /b+a+s+t+a+r+d+/,
  /w+h+o+r+e+/,
  /s+l+u+t+/,

  // Slang / abbreviations
  /m+o+f+o+/,
  /m+f+e*r+/,
  /w+t+f+/,
  /s+t+f+u+/,
  /g+t+f+o+/,

  // UK slang
  /w+a+n+k+e+r+/,
  /t+o+s+s+e+r+/,
  /b+e+l+l+e+n+d+/,
  /k+n+o+b+h+e+a+d+/,
  /p+l+o+n+k+e+r+/,

  // Aggressive insults
  /s+c+u+m+b+a+g+/,
  /d+u+m+b+a+s+s+/,
  /s+h+i*t+h+e+a+d+/,
  /d+i+p+s+h+i*t+/,
  /f+u*c+k+w+i+t+/,

  // Harmful phrases
  /k+i+l+l+y+o+u+r+s+e+l+f+/,
  /k+y+s+/,
];

export function findPolicyViolations(text = "") {
  const { tokens, glued } = tokenize(text);

  const wordMatches = bannedWords.filter((word) => {
    const target = collapseRepeats(normalizeText(word).replace(/[^a-z0-9]/g, ""));
    if (!target) return false;

    if (target.length < WHOLE_WORD_THRESHOLD) {
      // Short abbreviations ("bs", "mf", "die", "git", "kys", "wtf", ...)
      // must match as a whole token, otherwise we'd ban innocent words
      // that happen to contain those letters.
      return tokens.includes(target);
    }

    // Longer banned words still match as substrings so disguised
    // profanity (spaced/punctuated like "f.u.c.k") is caught after the
    // tokens are glued back together.
    return glued.includes(target);
  });

  // Patterns are regexes — they keep their original substring behaviour
  // because they were authored with intentional flexibility (e.g.
  // /f+u*c+k+/ catches "fck", "fuuuck"). They still run against the
  // glued token string.
  const patternMatches = bannedPatterns
    .filter((pattern) => pattern.test(glued))
    .map((pattern) => pattern.toString());

  return [...new Set([...wordMatches, ...patternMatches])];
}

export function isMessageSafe(text = "") {
  return findPolicyViolations(text).length === 0;
}

export function sanitizeMessage(text = "") {
  return isMessageSafe(text) ? text : "";
}