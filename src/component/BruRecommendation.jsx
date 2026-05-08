import { useEffect, useRef, useState } from "react";
import useQuotes from "../hooks/useQuotes";
import QuotesSection from "./QuotesSection";
import WeatherWidget from "./WeatherWidget";
import useWeather from "../hooks/useWeather";
import { API_BASE } from "../utils/api";

const ROTATION_INTERVAL_MS = 20 * 1000; // 20s per item on screen (incl. transition)
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // refetch list (and AI text) every 20 min
const EXIT_ANIMATION_MS = 2500; // matches slideOut duration in index.css

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
  const [recommendationError, setRecommendationError] = useState("");
  const [now, setNow] = useState(new Date());

  // Keep latest list in a ref so the rotation interval always sees fresh data
  const listRef = useRef(recommendations);
  useEffect(() => {
    listRef.current = recommendations;
  }, [recommendations]);

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

  // Rotate through items every ROTATION_INTERVAL_MS, looping back to start
  useEffect(() => {
    if (recommendations.length <= 1) return;

    const interval = setInterval(() => {
      setActiveIndex((prev) => {
        const list = listRef.current;
        if (!list.length) return 0;
        return (prev + 1) % list.length;
      });
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [recommendations.length]);

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

  // Log each impression when the new item is actually shown to viewers
  useEffect(() => {
    if (!current) return;

    let cancelled = false;
    fetch(`${API_BASE}/api/log-recommendation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: current.productName,
        reason: current.reason || "",
      }),
    }).catch((err) => {
      if (!cancelled) console.error("Log recommendation failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [current?.productName, displayedIndex]);

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
      <div className="grid h-full grid-cols-12 gap-2">
        {/* LEFT: rotating recommended food image with caption */}
        <div className="col-span-2 flex h-[84vh] flex-col overflow-hidden rounded-lg p-6 backdrop-blur-md max-[1750px]:px-4 py-2 bg-black/10">
          <div className="mt-4 flex flex-1 flex-col overflow-hidden max-[1750px]:mt-3">
            {recommendationError && !current ? (
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
                {/* Recommendation text shown ABOVE the image — comic-book speech bubble.
                    Text comes from the backend (AI-generated, served from cache). */}
                {current.recommendationText ? (
                  <div className="speech-bubble speech-bubble-enter mx-2 mb-6 text-center">
                    <p className="text-base font-semibold leading-snug max-[1750px]:text-sm">
                      {current.recommendationText}
                    </p>
                  </div>
                ) : null}

                <div className=" flex-1 overflow-hidden rounded-lg">
                  <img
                    src={current.imageUrl}
                    alt={current.productName}
                    className="w-full h-full object-scale-down"
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

        {/* BOTTOM: quotes / QR section */}
        <div className="col-span-12 h-35 max-[1750px]:h-15">
          <QuotesSection quotes={quotes} />
        </div>
      </div>
    </div>
  );
}
