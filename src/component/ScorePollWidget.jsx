import { useEffect, useMemo, useRef, useState } from "react";
import { QRCode } from "react-qr-code";

/* ---------------------------------------------------------------------------
 * Self-contained Score Poll widget (ported from the standalone app). Reads live
 * fixtures + votes from the Realtime Database's public REST API (no firebase
 * SDK needed) and points the QR + logo at the deployed widget.
 *
 * Set VITE_SCOREPOLL_DB_URL in this project's .env to your RTDB URL, e.g.
 *   VITE_SCOREPOLL_DB_URL=https://your-project-default-rtdb.firebaseio.com
 * ------------------------------------------------------------------------- */
const DB_URL = (
  import.meta.env.VITE_SCOREPOLL_DB_URL ||
  "https://YOUR-PROJECT-default-rtdb.firebaseio.com"
).replace(/\/$/, "");

const WIDGET_BASE = "https://location.hyperglow.co.uk/hg_score_poll";
const asset = (name) => `${WIDGET_BASE}/${name}`;

/* ----------------------------- selectors -------------------------------- */
const MATCH_DURATION = 120 * 60 * 1000;
const isVotable = (m) => Array.isArray(m.teams) && m.teams.every((t) => t.code);
const isOver = (m, t) =>
  m.status
    ? ["FINISHED", "AWARDED", "CANCELLED", "POSTPONED"].includes(m.status)
    : new Date(m.kickoff).getTime() + MATCH_DURATION < t;

const UK_TZ = "Europe/London";
const ukDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: UK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKey = (m) => ukDayFmt.format(new Date(m.kickoff));
const byKickoff = (a, b) => new Date(a.kickoff) - new Date(b.kickoff);

function getUpcomingDaysFixtures(fixtures, now, days = 2) {
  const t = now.getTime();
  const votable = fixtures.filter(isVotable).sort(byKickoff);
  const remaining = votable.filter((m) => !isOver(m, t));
  const pool = remaining.length ? remaining : votable;
  const order = [];
  for (const m of pool) {
    const d = dayKey(m);
    if (!order.includes(d)) order.push(d);
    if (order.length >= days) break;
  }
  const set = new Set(order);
  return pool.filter((m) => set.has(dayKey(m))).sort(byKickoff);
}

const fmtKickoffUK = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

// Played minute. The free football-data tier usually omits `minute`, so when
// it's missing we approximate from kickoff (best-effort, ignores the half-time
// break) to still show "how long it's been playing".
const playedMinute = (m) => {
  if (m.minute) return m.minute;
  const mins = Math.floor((Date.now() - new Date(m.kickoff).getTime()) / 60000);
  return mins >= 0 && mins <= 130 ? mins : null;
};

const statusLine = (m) => {
  if (m.status === "IN_PLAY") {
    const min = playedMinute(m);
    return min != null ? `LIVE ${min}'` : "LIVE";
  }
  if (m.status === "PAUSED") return "HALF-TIME";
  if (m.status === "FINISHED") return "FULL-TIME";
  return fmtKickoffUK(m.kickoff);
};
const hasScore = (m) =>
  m.score && ["IN_PLAY", "PAUSED", "FINISHED"].includes(m.status);

/* ------------------------- data via RTDB REST --------------------------- */
function useFixtures() {
  const [fixtures, setFixtures] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${DB_URL}/worldcup/fixtures.json`);
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : data
            ? Object.values(data)
            : [];
        // Sticky: only adopt a non-empty list, never clear it on a transient
        // empty/missing response. Keeps fixtures stable between polls.
        if (active && list.length) setFixtures(list);
      } catch {
        /* keep last value */
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  return { fixtures: fixtures || [], loading };
}

// Last successfully fetched votes, kept per match. When the connection drops,
// each match keeps showing its own last-known numbers (never blank, never the
// wrong match's numbers, and no error shown).
const VOTE_CACHE = {};

function useVotes(matchId) {
  const [votes, setVotes] = useState(() => (matchId && VOTE_CACHE[matchId]) || {});
  useEffect(() => {
    if (!matchId) {
      setVotes({});
      return;
    }
    // Show whatever we last had for this match straight away.
    setVotes(VOTE_CACHE[matchId] || {});
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(
          `${DB_URL}/polls/${encodeURIComponent(matchId)}/votes.json`,
        );
        const data = await res.json();
        if (active) {
          VOTE_CACHE[matchId] = data || {};
          setVotes(VOTE_CACHE[matchId]);
        }
      } catch {
        /* offline: keep the last-known votes for this match */
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [matchId]);
  return votes;
}

/* ------------------------------- pieces --------------------------------- */
function VoteQR({ matchId, size }) {
  const url = matchId
    ? `${WIDGET_BASE}/vote?m=${encodeURIComponent(matchId)}`
    : `${WIDGET_BASE}/vote`;
  // A white quiet zone (padding) around the code is required for cameras to
  // lock on — without it the rounded corners clip the finder patterns and
  // scanning fails from a distance. Level "L" keeps the module count low so
  // each module is as big (and as scannable) as possible.
  const pad = 6; // fixed 8px white quiet zone
  const inner = Math.max(40, size - pad);
  return (
    <div
      className="bg-white rounded-lg flex items-center justify-center"
      style={{ width: size, height: size, padding: pad }}
    >
      <QRCode
        value={url}
        level="L"
        size={inner}
        bgColor="#ffffff"
        fgColor="#000000"
        style={{ width: inner, height: inner }}
      />
    </div>
  );
}

// One team's side, mirrored: from the centre out it reads flag -> name -> %,
// and the bar fills from the flag (centre) toward the outer edge.
function TeamSide({ team, pct, goals, isLeader, side, flagW, flagH }) {
  const right = side === "right";
  const flag = (
    <div className="relative shrink-0">
      {team.flag ? (
        <img
          src={team.flag}
          alt={`${team.name} flag`}
          className="object-cover rounded-md ring-1 ring-white/15"
          style={{ width: flagW, height: flagH }}
        />
      ) : (
        <span
          className="rounded-md bg-[#0e1430] text-[#9aa4c8] font-extrabold flex items-center justify-center"
          style={{ width: flagW, height: flagH }}
        >
          ?
        </span>
      )}
      {goals != null && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded bg-white/20 backdrop-blur-md border border-white/30 text-white font-extrabold text-xs flex items-center justify-center tabular-nums">
          {goals}
        </span>
      )}
    </div>
  );
  const name = (
    <span className="font-bold text-[14px] leading-none text-[#eef1fb] truncate min-w-0 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
      {team.name}
    </span>
  );
  const percent = (
    <span
      className={`shrink-0 font-extrabold tabular-nums text-[14px] leading-none ${
        isLeader ? "text-green-400" : "text-[#eef1fb]"
      }`}
    >
      {pct.toFixed(0)}%
    </span>
  );
  // body: name (nearest the flag) + % (outer), with the bar below.
  const body = (
    <div className="flex flex-col gap-2 min-w-0 flex-1">
      <div
        className={`flex items-center gap-2 min-w-0 ${
          right ? "justify-start" : "justify-end"
        }`}
      >
        {right ? (
          <>
            {name}
            {percent}
          </>
        ) : (
          <>
            {percent}
            {name}
          </>
        )}
      </div>
      {/* bar fills from the flag (centre) outward */}
      <div className="h-4 rounded-full overflow-hidden bg-black/25 border border-white/15">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            marginLeft: right ? undefined : "auto",
            background:
              "linear-gradient(180deg, rgba(226,229,236,0.95), rgba(150,156,176,0.92))",
          }}
        />
      </div>
    </div>
  );
  // flag sits in its own column toward the centre (its previous position).
  return (
    <div className="flex-1 flex items-center gap-3 min-w-0">
      {right ? (
        <>
          {flag}
          {body}
        </>
      ) : (
        <>
          {body}
          {flag}
        </>
      )}
    </div>
  );
}

function Loader() {
  const [ok, setOk] = useState(true);
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="relative flex items-center justify-center w-16 h-16">
        <span className="absolute inset-0 rounded-full border-2 border-white/10 border-t-[#4f8cff] animate-spin" />
        {ok ? (
          <img
            src={asset("fifa_2026.png")}
            onError={() => setOk(false)}
            alt="World Cup 2026"
            className="h-9 object-contain animate-pulse"
          />
        ) : (
          <span className="text-[#4f8cff] font-black text-lg animate-pulse">
            26
          </span>
        )}
      </div>
      <span className="text-[10px] tracking-[0.3em] uppercase text-[#9aa4c8]">
        Loading…
      </span>
    </div>
  );
}

/* ------------------------------- widget --------------------------------- */
export default function ScorePollWidget() {
  const { fixtures, loading } = useFixtures();
  const [tick, setTick] = useState(0);
  const [index, setIndex] = useState(0);

  // Measure the widget so the QR / flags scale to fill the available height.
  const boxRef = useRef(null);
  const [boxH, setBoxH] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBoxH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const PAD_Y = 16; // py-2 (8px top + 8px bottom)
  const inner = Math.max(0, boxH - PAD_Y);
  const qrSize = Math.max(60, boxH - 2); // QR sits outside the box, full height
  const flagH = Math.max(38, Math.round(inner * 0.52));
  const flagW = Math.round(flagH * 1.6);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const dayFixtures = useMemo(
    () => getUpcomingDaysFixtures(fixtures, new Date(), 2),
    [fixtures, tick],
  );
  const slideCount = dayFixtures.length + 1;

  useEffect(() => {
    setIndex((i) => i % slideCount);
  }, [slideCount]);
  useEffect(() => {
    if (slideCount <= 1) return;
    const ms = index === 0 ? 3000 : 10000; // intro 3s, match slides 10s
    const id = setTimeout(() => setIndex((i) => (i + 1) % slideCount), ms);
    return () => clearTimeout(id);
  }, [index, slideCount]);

  const isIntro = index === 0;
  const match = isIntro ? null : dayFixtures[index - 1] || null;
  const votes = useVotes(match?.id);

  const [teamA, teamB] = match ? match.teams : [null, null];
  const va = teamA ? votes[teamA.code] || 0 : 0;
  const vb = teamB ? votes[teamB.code] || 0 : 0;
  const tot = va + vb;
  const pa = tot ? (va / tot) * 100 : 0;
  const pb = tot ? (vb / tot) * 100 : 0;
  const score = match && hasScore(match) ? match.score : null;

  return (
    <div ref={boxRef} className="h-full w-full">
      <div className="flex h-full items-stretch gap-2">
        {/* content box — same style as the quote section */}
        <div className="relative flex h-full flex-1 items-center gap-3 overflow-hidden rounded-lg bg-black/10 px-6 py-2 backdrop-blur-md">
          {/* match label + status — top right corner */}
          {!loading && match && (
            <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-bl-xl bg-black/40 text-[14px] max-w-[60%]">
              <span className="text-[#9aa4c8] truncate">{match.label}</span>
              <span
                className={`shrink-0 ${
                  match.status === "IN_PLAY"
                    ? "text-[#4f8cff] font-bold"
                    : "text-white"
                }`}
              >
                · {statusLine(match)}
              </span>
            </div>
          )}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader />
            </div>
          ) : isIntro ? (
            <div className="flex-1 h-full flex items-center justify-center gap-4 px-2">
              <span className="font-black text-[#eef1fb] tracking-tight text-[1.3rem] leading-tight text-center [text-shadow:0_2px_4px_rgba(0,0,0,0.55)]">
                Scan QR Code &amp; Support Your Team
              </span>
              <img
                src={asset("fifa_2026.png")}
                alt="World Cup 2026"
                className="h-[74px] w-auto object-contain shrink-0"
              />
            </div>
          ) : match ? (
            <>
              <TeamSide
                team={teamA}
                pct={pa}
                goals={score ? score.home : null}
                isLeader={tot > 0 && va >= vb}
                side="left"
                flagW={flagW}
                flagH={flagH}
              />
              <span className="shrink-0 text-white font-bold text-sm px-1">
                v
              </span>
              <TeamSide
                team={teamB}
                pct={pb}
                goals={score ? score.away : null}
                isLeader={tot > 0 && vb > va}
                side="right"
                flagW={flagW}
                flagH={flagH}
              />
            </>
          ) : null}
        </div>

        {/* QR — outside the box, in its own right column (like the quote section) */}
        {!loading && (
          <div className="flex h-full flex-col items-center justify-center shrink-0">
            {/* One constant QR for every slide — always the generic vote page
                (which already lists all matches). Keeping the value fixed means
                the code never changes, so a camera can stay locked on it. */}
            <VoteQR size={qrSize} />
          </div>
        )}
      </div>
    </div>
  );
}
