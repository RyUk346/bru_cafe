// utils/moderation.js

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9]/g, "");
}

function collapseRepeats(text = "") {
  return text.replace(/(.)\1+/g, "$1");
}

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
  const normalized = collapseRepeats(normalizeText(text));

  const wordMatches = bannedWords.filter((word) =>
    normalized.includes(collapseRepeats(normalizeText(word))),
  );

  const patternMatches = bannedPatterns
    .filter((pattern) => pattern.test(normalized))
    .map((pattern) => pattern.toString());

  return [...new Set([...wordMatches, ...patternMatches])];
}

export function isMessageSafe(text = "") {
  return findPolicyViolations(text).length === 0;
}

export function sanitizeMessage(text = "") {
  return isMessageSafe(text) ? text : "";
}