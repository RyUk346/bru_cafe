import { useEffect, useRef, useState } from "react";
import useQuotes from "../hooks/useQuotes";
import QuotesSection from "./QuotesSection";
import WeatherWidget from "./WeatherWidget";
import useWeather from "../hooks/useWeather";
import { API_BASE } from "../utils/api";
import { PiGlobeXBold } from "react-icons/pi";
import ScorePollWidget from "./ScorePollWidget";
import GoogleReviews from "./GoogleReviews";

const ROTATION_INTERVAL_MS = 17 * 1000; // 20s per item on screen (incl. transition)
// PDF spec: backend rebuilds recommendations every 15 minutes — match it
// here so the UI never lags behind the latest AI selection.
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // refetch list every 15 min
const EXIT_ANIMATION_MS = 3000; // matches slideOut duration in index.css
// The left panel loops between two full views forever:
//   UI 1 — recommendation (image + speech-bubble recommendation text)
//   UI 2 — Google reviews (vertical carousel, scrolling bottom → top)
// UI 1 runs the image carousel this many FULL passes before handing over
// to UI 2. With ~3 items at 20s each (17s on screen + ~3s slide), one pass
// ≈ 1 minute, so 3 passes ≈ 3 minutes — but it's counted in rotations,
// not wall-clock time, so the UI never cuts an image off mid-turn.
const RECOMMENDATION_PASSES = 3;
// Each review holds the top of the carousel for this long; UI 2 stays on
// screen exactly long enough for EVERY review to take a full turn, so all
// 6 reviews are always shown before looping back to UI 1.
const REVIEW_STEP_MS = 5 * 1000;

export default function BruRecommendationBoard() {
  const weather = useWeather();
  const { quotes } = useQuotes();

  const [recommendations, setRecommendations] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Index of the item *currently shown* on screen. Lags activeIndex by
  // EXIT_ANIMATION_MS so the outgoing item can finish its slide-out before
  // we swap to the new one.
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  // Which full-panel view is on screen: "recommendation" (UI 1) or
  // "reviews" (UI 2). The two alternate in an infinite loop — UI 1 runs
  // through every recommendation once, then UI 2 shows the Google reviews
  // for REVIEWS_VIEW_MS, then back to UI 1, forever.
  const [view, setView] = useState("recommendation");
  const [reviewsCount, setReviewsCount] = useState(0);
  const hasReviews = reviewsCount > 0;
  const [recommendationError, setRecommendationError] = useState("");
  const [now, setNow] = useState(new Date());
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  // Keep latest list in a ref so the rotation interval always sees fresh data
  const listRef = useRef(recommendations);
  useEffect(() => {
    listRef.current = recommendations;
  }, [recommendations]);
  // Mirror activeIndex in a ref so the rotation interval can check "was
  // that the last item?" without re-subscribing on every tick.
  const activeIndexRef = useRef(0);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);
  // How many full passes the image carousel has completed since UI 1 came
  // on screen — the view hands over to UI 2 after RECOMMENDATION_PASSES.
  const passCountRef = useRef(0);

  // Clock tick
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recommendations from backend
  useEffect(() => {
    let cancelled = false;

    async function loadRecommendations() {
      try {
        const res = await fetch(`${API_BASE}/api/recommendation`);

        if (!res.ok) {
          const text = await res.text();
          console.error("Recommendation API error:", text);
          if (!cancelled) setRecommendationError("Recommendation unavailable");
          return;
        }

        const json = await res.json();

        if (cancelled) return;

        let list = Array.isArray(json.recommendations)
          ? json.recommendations
          : [];

        // Backward-compat: build a single-item list from old payload shape
        if (!list.length && json.selectedFood && json.selectedImage) {
          list = [
            {
              productName: json.selectedFood,
              productDescription: "",
              recommendationText:
                json.message || `Try our ${json.selectedFood}`,
              condition: "",
              imageUrl: json.selectedImage,
              reason: json.message || "",
            },
          ];
        }

        setRecommendations(list);
        setActiveIndex(0);
        setDisplayedIndex(0);
        setIsExiting(false);
        passCountRef.current = 0; // fresh list → restart the pass counter
        setRecommendationError(list.length ? "" : "No recommendations");
      } catch (error) {
        console.error("Recommendation fetch failed:", error);
        if (!cancelled) setRecommendationError("Recommendation unavailable");
      }
    }

    loadRecommendations();
    const interval = setInterval(loadRecommendations, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Rotate through items every ROTATION_INTERVAL_MS. The UI 1 → UI 2
  // switch is NOT on a fixed timer: the board counts FULL carousel passes
  // (every image had its complete 17s + slide turn) and hands over to the
  // reviews view only after RECOMMENDATION_PASSES complete passes — so
  // the UI never changes suddenly mid-image. With no reviews available it
  // simply keeps looping.
  useEffect(() => {
    if (view !== "recommendation") return;
    if (!recommendations.length) return;

    const interval = setInterval(() => {
      const list = listRef.current;
      if (!list.length) return;

      const prev = activeIndexRef.current;
      const carouselFinished = prev >= list.length - 1;

      if (carouselFinished) {
        passCountRef.current += 1;

        if (passCountRef.current >= RECOMMENDATION_PASSES && hasReviews) {
          // 3 full passes done → show UI 2, and reset the carousel so it
          // starts fresh from the first item when UI 1 comes back.
          passCountRef.current = 0;
          setView("reviews");
          setActiveIndex(0);
          setDisplayedIndex(0);
          setIsExiting(false);
          return;
        }

        // Wrap around and start the next pass.
        setActiveIndex(0);
        return;
      }

      setActiveIndex(prev + 1);
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [recommendations.length, view, hasReviews]);

  // UI 2 → UI 1: the reviews carousel gets exactly one full cycle (every
  // review takes a turn at the top: count × REVIEW_STEP_MS), then the
  // board returns to the recommendation view. The reverse handoff is
  // event-driven by the image carousel finishing (see effect above).
  useEffect(() => {
    if (view !== "reviews") return;

    if (!hasReviews) {
      setView("recommendation");
      return;
    }

    const timer = setTimeout(() => {
      setView("recommendation");
    }, Math.max(reviewsCount, 1) * REVIEW_STEP_MS);

    return () => clearTimeout(timer);
  }, [view, hasReviews, reviewsCount]);

  // Staged transition between items so the slide-in animation is actually
  // visible: when activeIndex changes, run a slide-out on the current item
  // for EXIT_ANIMATION_MS, then swap displayedIndex (key change → new item
  // mounts and slides in via the default .animated-image animation).
  useEffect(() => {
    if (activeIndex === displayedIndex) {
      // Active and displayed are aligned — make sure exit class is cleared
      if (isExiting) setIsExiting(false);
      return;
    }

    setIsExiting(true);

    const swapTimer = setTimeout(() => {
      setDisplayedIndex(activeIndex);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(swapTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, displayedIndex]);

  // The item actually on screen is recommendations[displayedIndex]
  // (which may lag activeIndex by EXIT_ANIMATION_MS during a rotation).
  const current = recommendations[displayedIndex];

  // Note: per-impression logging has been moved to the server side.
  // The server now writes one new row to the Recommendation Log sheet (and
  // updates the Food Recommendation sheet's Recommended/Recommendation Text
  // columns) each time the AI recommendation refreshes (every
  // REFRESH_INTERVAL_MS). See server.js → notifyRecommendationRefresh().

  const currentDate = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const currentTime = now
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();

  return (
    <div className="h-screen w-screen overflow-hidden p-2 text-white">
      <div className="grid h-full grid-cols-13 gap-2">
        {/* LEFT: rotating recommended food image with caption */}
        <div className="col-span-3 w-[239px] flex h-full flex-col overflow-hidden rounded-lg p-6 backdrop-blur-md max-[1750px]:px-4 py-2 bg-black/20">
          <div className="border-b border-white/50 pb-2">
            <h1 className="text-xl font-bold tracking-wide">
              {view === "reviews" ? "The Bru Experience" : "How you Bru-ing?"}
            </h1>
          </div>
          <div className="mt-4 flex flex-1 flex-col overflow-hidden max-[1750px]:mt-3">
            {/* UI 2 — Google reviews. Stays mounted (so reviews keep
                refreshing in the background) but only renders while the
                board is on the reviews view. */}
            <GoogleReviews
              active={view === "reviews"}
              stepMs={REVIEW_STEP_MS}
              onReviewsCount={setReviewsCount}
            />

            {view !== "recommendation" ? null : recommendationError &&
              !current ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-4 text-center text-red-300">
                {recommendationError}
              </div>
            ) : !current ? (
              <div className="flex h-full items-center justify-center text-center text-white/70">
                Loading recommendation...
              </div>
            ) : (
              <div
                key={`${current.productName}-${displayedIndex}`}
                className={`flex flex-1 flex-col overflow-hidden rounded-lg animated-image${
                  isExiting ? " exiting" : ""
                }`}
              >
                {/* RECOMMENDATION TEXT speech bubble */}
                {current.recommendationText ? (
                  <div className="speech-bubble speech-bubble-enter mx-1">
                    <div className="speech-bubble-back">
                      <svg
                        className="speech-bubble-shape"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M 0,8 Q 0,0 7.84,1.57 L 92.16,18.43 Q 100,20 100,28 L 100,92 Q 100,100 92,100 L 8,100 Q 0,100 0,92 Z"
                          fill="#cfac60"
                        />
                      </svg>
                      <div className="speech-bubble-tail" />
                    </div>
                    <div className="speech-bubble-front -left-0">
                      <svg
                        className="speech-bubble-shape"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M 0,28 Q 0,20 7.84,18.43 L 92.16,1.57 Q 100,0 100,8 L 100,92 Q 100,100 92,100 L 8,100 Q 0,100 0,92 Z"
                          fill="#dfdbd2cc"
                        />
                      </svg>
                      <p className="text-center text-base font-semibold leading-snug max-[1750px]:text-sm">
                        {current.recommendationText}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="image-enter flex-1 overflow-hidden rounded-lg">
                  <img
                    src={current.imageUrl}
                    alt={current.productName}
                    className="block w-[480px] h-full object-cover"
                  />

                  {/* <div className="inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-center">
                    <p className="text-xl font-black leading-tight max-[1750px]:text-base">
                      {current.productName}
                    </p>
                  </div> */}
                </div>

                {recommendations.length > 1 && (
                  <div className="mt-2 flex justify-center gap-1.5">
                    {recommendations.map((_, idx) => (
                      <span
                        key={idx}
                        className={`h-1.5 w-1.5 rounded-full transition-colors ${
                          idx === displayedIndex ? "bg-white" : "bg-white/30"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: weather/date area */}
        <div className="col-span-10 flex h-full flex-col">
          <div className="flex h-35 max-[1750px]:h-18 justify-end rounded-lg backdrop-blur-md">
            <div className="flex h-full w-full items-stretch justify-end">
              <WeatherWidget
                temperature={weather.temperature}
                maxTemperature={weather.maxTemperature}
                minTemperature={weather.minTemperature}
                icon={weather.icon}
                label={weather.label}
                loading={weather.loading}
                error={weather.error}
              />

              <div className="ml-2 flex h-full min-w-[100px] flex-col items-end justify-center overflow-hidden rounded-lg border border-white/10 bg-black/10 px-6 py-4 text-right max-[1750px]:px-4">
                <div className="text-sm font-semibold text-white/60">
                  {currentDate}
                </div>
                <div className="text-3xl font-bold tabular-nums text-white max-[1750px]:text-xl">
                  {currentTime}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1" />
        </div>

        {/* Subtle offline warning above the QR (right-justified).
              Hidden via `invisible` (not display:none) so the QR stays
              vertically anchored when online status toggles. */}
        <div
          className={`absolute bottom-18 right-2 flex w-full justify-end ${
            isOnline ? "invisible" : ""
          }`}
          // style={{ width: qrSize }}
          aria-hidden={isOnline ? "true" : "false"}
          title={isOnline ? undefined : "No internet connection"}
        >
          <PiGlobeXBold className="text-red-500" />
        </div>
        {/* BOTTOM: quotes / QR section */}
        {/* <div className="col-span-13 h-35 max-[1750px]:h-15">
          <QuotesSection quotes={quotes} />
        </div> */}
        {/* <div className="col-span-13 h-38 max-[1750px]:h-15">
          <ScorePollWidget />
        </div> */}
      </div>
    </div>
  );
}
