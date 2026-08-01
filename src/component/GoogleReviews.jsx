import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { API_BASE } from "../utils/api";
import { isMessageSafe } from "../utils/messageFilter";
import { timeAgo } from "../utils/date";

/* ──────────────────────────────────────────────────────────────────────────
   GOOGLE REVIEWS — UI 2 of the board's infinite loop

   Reviews come from this app's own backend (GET /api/google-reviews), which
   reads PUBLIC Google reviews via Outscraper and returns the latest 5-star
   reviews. No Google Business Profile login is required, and the Outscraper
   API key stays server-side (see server.js + .env → OUTSCRAPER_API_KEY).

   The backend already filters to 5-star, sorts newest-first, caps the list
   to 6, and caches ~12h. This component renders them (with each reviewer's
   Google profile picture when available) as a VERTICAL CAROUSEL: several
   cards are visible at once, and every
   STEP_INTERVAL_MS the column scrolls up by exactly one card with a smooth
   eased transition. The list is rendered twice so that after stepping past
   the last review the track snaps (invisibly, with the transition disabled)
   back to the identical first card — an infinite loop with no jump.

   Props:
   - active       → whether UI 2 is currently on screen. The component stays
                    mounted either way so the hourly refresh keeps running;
                    it just renders nothing while UI 1 is showing.
   - onHasReviews → reports availability so the board only loops to UI 2
                    when there is something to show.
   ────────────────────────────────────────────────────────────────────────── */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-check the backend hourly
const MAX_REVIEWS = 6; // show up to 6 five-star reviews
const STEP_TRANSITION_MS = 1400; // silky 1.4s glide per step
// Symmetric ease-in-out: starts gently, cruises, settles gently — much
// smoother on a big cafe screen than a sharp ease-out.
const STEP_EASING = "cubic-bezier(0.45, 0.05, 0.25, 1)";

export default function GoogleReviews({
  active = true,
  stepMs = 6 * 1000, // pause per step — driven by the board (REVIEW_STEP_MS)
  onReviewsCount,
}) {
  const [reviews, setReviews] = useState([]);
  // Carousel position: index of the card currently at the top of the
  // viewport. Can momentarily equal reviews.length (first card of the
  // duplicate copy) right before the seamless snap back to 0.
  const [step, setStep] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [offset, setOffset] = useState(0);
  const trackRef = useRef(null);

  // Fetch the latest 5-star reviews from our backend
  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      try {
        const res = await fetch(`${API_BASE}/api/google-reviews`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const fiveStar = (json.reviews || [])
          .filter((r) => (r.rating ?? 0) === 5 && r.text && r.text.trim())
          // Defence-in-depth: the backend already runs the full 3-layer
          // moderation (banned-word filter → OpenAI moderation → LLM
          // judge) before a review reaches this endpoint. This client-side
          // pass re-runs the deterministic word filter as a last guard so
          // nothing unsafe can render even from a stale/edge-case payload.
          .filter((r) => isMessageSafe(r.text) && isMessageSafe(r.name || ""))
          .slice(0, MAX_REVIEWS);

        if (!cancelled) setReviews(fiveStar);
      } catch (err) {
        console.error("Google reviews fetch failed:", err);
      }
    }

    loadReviews();
    const interval = setInterval(loadReviews, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Tell the board how many reviews there are, so it can keep UI 2 on
  // screen exactly long enough for a full carousel cycle (all 6 reviews).
  useEffect(() => {
    onReviewsCount?.(reviews.length);
  }, [reviews.length, onReviewsCount]);

  // Restart the carousel from the top each time UI 2 comes on screen
  useEffect(() => {
    if (active) {
      setAnimate(false);
      setStep(0);
    }
  }, [active]);

  // Advance the carousel one card at a time while on screen
  useEffect(() => {
    if (!active || reviews.length <= 1) return;

    const interval = setInterval(() => {
      setStep((prev) => prev + 1);
    }, stepMs);

    return () => clearInterval(interval);
  }, [active, reviews.length, stepMs]);

  // Measure how far the track must slide so card[step] sits at the top.
  // Measured from the DOM (offsetTop) so cards can have natural heights.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const child = track.children[step];
    setOffset(child ? child.offsetTop : 0);
  }, [step, reviews, active]);

  // Seamless infinite loop: after animating onto the duplicate copy's
  // first card, snap back to the real first card with the transition off
  // (identical pixels, so the reset is invisible).
  useEffect(() => {
    if (!reviews.length || step < reviews.length) return;

    const timer = setTimeout(() => {
      setAnimate(false);
      setStep(0);
    }, STEP_TRANSITION_MS + 50);

    return () => clearTimeout(timer);
  }, [step, reviews.length]);

  // Re-enable the transition one frame after any snap-reset
  useEffect(() => {
    if (animate) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimate(true)),
    );
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  // Render nothing while UI 1 is on screen (or if there are no reviews) —
  // the component itself stays mounted so the refresh interval survives.
  if (!active || !reviews.length) return null;

  const activeDot = step % reviews.length;

  const renderCard = (review, key) => {
    const name = review.name || "Google user";
    return (
      <div key={key} className="mb-3 rounded-lg bg-black/25 p-3">
        {/* 1. Reviewer — avatar + name */}
        <div className="flex items-center gap-2">
          {review.avatarUrl ? (
            <img
              src={review.avatarUrl}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // Broken/blocked avatar → hide the img so only the name shows
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold text-white">
              {name.charAt(0)}
            </div>
          )}
          <span className="text-xs font-medium text-white/70">{name}</span>
        </div>

        {/* 2. Star rating + when the review was posted */}
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="text-sm leading-none text-[#ffc107]"
            aria-label={`${review.rating} out of 5 stars`}
          >
            {"★".repeat(review.rating)}
          </span>
          {review.timestamp ? (
            <span className="text-[11px] leading-none text-white/50">
              {timeAgo(review.timestamp)}
            </span>
          ) : null}
        </div>

        {/* 3. Full review text — no truncation */}
        <p className="mt-1 line-clamp-4 text-sm leading-snug text-white/90 max-[1750px]:text-xs">
          {"“"}
          {review.text}
          {"”"}
        </p>
      </div>
    );
  };

  return (
    <div className="view-enter flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* <div className="mb-2 flex shrink-0 items-center gap-2 text-sm font-semibold text-white/80">
        <FcGoogle className="text-xl" />
        <span>What people say</span> 
      </div>  */}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Carousel track: the flat card list is rendered twice so the
            wrap-around step lands on identical pixels before the snap. */}
        <div
          ref={trackRef}
          className="reviews-track"
          style={{
            // translate3d keeps the glide on the GPU compositor — no
            // layout/paint per frame, so the motion stays butter-smooth.
            transform: `translate3d(0, -${offset}px, 0)`,
            transition: animate
              ? `transform ${STEP_TRANSITION_MS}ms ${STEP_EASING}`
              : "none",
          }}
        >
          {[0, 1].map((copyIdx) =>
            reviews.map((review, idx) =>
              renderCard(review, `${copyIdx}-${review.id ?? idx}`),
            ),
          )}
        </div>

        {/* Soft fade at the bottom edge so the next card glides in */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/30 to-transparent" />
      </div>

      {/* Carousel dots — which review is currently at the top */}
      {reviews.length > 1 && (
        <div className="mt-1.5 flex shrink-0 justify-center gap-1">
          {reviews.map((_, idx) => (
            <span
              key={idx}
              className={`h-1 w-1 rounded-full transition-colors ${
                idx === activeDot ? "bg-white" : "bg-white/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
