import { useEffect, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { API_BASE } from "../utils/api";

/* ──────────────────────────────────────────────────────────────────────────
   GOOGLE REVIEWS

   Reviews come from this app's own backend (GET /api/google-reviews), which
   reads PUBLIC Google reviews via Outscraper and returns the latest 5-star
   reviews. No Google Business Profile login is required, and the Outscraper
   API key stays server-side (see server.js + .env → OUTSCRAPER_API_KEY).

   The backend already filters to 5-star, sorts newest-first, caps the list to
   6, and caches ~12h — so this component just displays and rotates the result.
   Each review: { id, name, avatarUrl, text, rating, timestamp }.
   ────────────────────────────────────────────────────────────────────────── */
const ROTATE_INTERVAL_MS = 10 * 1000; // show each review for 10s
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-check the backend hourly
const MAX_REVIEWS = 6; // show up to 6 five-star reviews

export default function GoogleReviews() {
  const [reviews, setReviews] = useState([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const listRef = useRef([]);

  useEffect(() => {
    listRef.current = reviews;
  }, [reviews]);

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
          .slice(0, MAX_REVIEWS);

        if (cancelled) return;
        setReviews(fiveStar);
        setIndex(0);
        setError(fiveStar.length ? "" : "No reviews");
      } catch (err) {
        console.error("Google reviews fetch failed:", err);
        if (!cancelled) setError("Reviews unavailable");
      }
    }

    loadReviews();
    const interval = setInterval(loadReviews, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Rotate through the reviews, looping back to the start
  useEffect(() => {
    if (reviews.length <= 1) return;

    const interval = setInterval(() => {
      setIndex((prev) => {
        const list = listRef.current;
        if (!list.length) return 0;
        return (prev + 1) % list.length;
      });
    }, ROTATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [reviews.length]);

  // Nothing to show — stay invisible rather than cluttering the board
  if (!reviews.length) return null;

  const review = reviews[index];
  const name = review.name || "Google user";

  return (
    <div className="mb-3 shrink-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-white/70">
        <FcGoogle className="text-base" />
        <span>What people say</span>
      </div>

      <div
        key={review.id ?? index}
        className="rounded-lg bg-black/25 p-3"
        style={{
          animation: "slideInFromLeft 600ms cubic-bezier(0.25, 0.9, 0.3, 1) both",
        }}
      >
        <div
          className="mb-1 text-sm leading-none text-[#ffc107]"
          aria-label={`${review.rating} out of 5 stars`}
        >
          {"★".repeat(review.rating)}
        </div>

        <p className="line-clamp-5 text-sm leading-snug text-white/90 max-[1750px]:text-xs">
          {"“"}
          {review.text}
          {"”"}
        </p>

        <div className="mt-2 flex items-center gap-2">
          {review.avatarUrl ? (
            <img
              src={review.avatarUrl}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold text-white">
              {name.charAt(0)}
            </div>
          )}
          <span className="text-xs font-medium text-white/70">{name}</span>
        </div>
      </div>

      {reviews.length > 1 && (
        <div className="mt-1.5 flex justify-center gap-1">
          {reviews.map((_, idx) => (
            <span
              key={idx}
              className={`h-1 w-1 rounded-full transition-colors ${
                idx === index ? "bg-white" : "bg-white/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
