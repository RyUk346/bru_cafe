import { useEffect, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";

/* ──────────────────────────────────────────────────────────────────────────
   GOOGLE REVIEWS (via Featurable — free, no Google login / API key required)

   HOW TO CONNECT THIS CAFE'S REVIEWS:
     1. Go to https://featurable.com and create a free account.
     2. Create a new widget and search for the cafe's Google Business listing
        (the same place as your Google review link).
     3. In the widget settings, set the minimum rating to 5 stars (optional —
        we also filter to 5-star below) and let it pull the reviews.
     4. Click  Embed  ->  API. Copy ONLY the widget UUID at the END of the URL
        (e.g. from .../v2/widgets/0cde5c9c-...  copy just "0cde5c9c-..."),
        NOT the whole URL.
     5. Paste that UUID into FEATURABLE_WIDGET_ID below.

   Uses the Featurable v2 API. Set the ID to "example" to preview sample data.
   ────────────────────────────────────────────────────────────────────────── */
const FEATURABLE_WIDGET_ID = "0cde5c9c-3a50-434c-b590-57625e6af9ca";

const FEATURABLE_API = (id) => `https://api.featurable.com/v2/widgets/${id}`;

const ROTATE_INTERVAL_MS = 10 * 1000; // show each review for 10s
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-fetch reviews hourly
const MAX_REVIEWS = 6; // show up to 6 five-star reviews

export default function GoogleReviews() {
  const [reviews, setReviews] = useState([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const listRef = useRef([]);

  useEffect(() => {
    listRef.current = reviews;
  }, [reviews]);

  // Fetch + filter to five-star reviews
  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      try {
        const res = await fetch(FEATURABLE_API(FEATURABLE_WIDGET_ID));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        // v2 shape: json.widget.reviews[]  (fall back to v1 json.reviews[])
        const rawReviews = json.widget?.reviews || json.reviews || [];
        const fiveStar = rawReviews
          .map((r) => ({
            id: r.id ?? r.reviewId ?? null,
            name: r.author?.name || r.reviewer?.displayName || "Google user",
            avatarUrl: r.author?.avatarUrl || r.reviewer?.profilePhotoUrl || "",
            text: (r.text ?? r.comment ?? "").trim(),
            rating: r.rating?.value ?? r.starRating ?? 0,
          }))
          .filter((r) => r.rating === 5 && r.text)
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
  const name = review.name;

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
