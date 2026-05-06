import { useEffect, useState } from "react";
import useQuotes from "../hooks/useQuotes";
import QuotesSection from "./QuotesSection";
import WeatherWidget from "./WeatherWidget";
import useWeather from "../hooks/useWeather";

export default function BruRecommendationBoard() {
  const weather = useWeather();
  const { quotes } = useQuotes();

  const [recommendation, setRecommendation] = useState(null);
  const [recommendationError, setRecommendationError] = useState("");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function loadRecommendation() {
      try {
        const res = await fetch("/api/recommendation");

        if (!res.ok) {
          const text = await res.text();
          console.error("Recommendation API error:", text);
          setRecommendationError("Recommendation unavailable");
          return;
        }

        const json = await res.json();
        setRecommendation(json);
        setRecommendationError("");
      } catch (error) {
        console.error("Recommendation fetch failed:", error);
        setRecommendationError("Recommendation unavailable");
      }
    }

    loadRecommendation();

    const interval = setInterval(loadRecommendation, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
        {/* LEFT: replaced leaderboard with recommended food image */}
        <div className="col-span-2 flex h-[84vh] flex-col overflow-hidden rounded-lg p-6 backdrop-blur-md max-[1750px]:px-4 py-2">
          <div className="mt-4 flex flex-1 flex-col overflow-hidden max-[1750px]:mt-3">
            {recommendationError ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-4 text-center text-red-300">
                {recommendationError}
              </div>
            ) : !recommendation ? (
              <div className="flex h-full items-center justify-center text-center text-white/70">
                Loading recommendation...
              </div>
            ) : (
              <>
                <div className=" flex-1 overflow-hidden rounded-lg animated-image">
                  <img
                    src={recommendation.selectedImage}
                    alt={recommendation.selectedFood}
                    className="w-full object-cover "
                  />

                  <div className="inset-x-0 bottom-0 bg-linear-to-t text-center from-black/50 to-transparent p-3">
                    <p className="text-xl font-black leading-tight max-[1750px]:text-base">
                      {recommendation.selectedFood}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT: keep weather/date area same, remove routine section */}
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

          {/* Empty main area after removing class routine */}
          <div className="flex-1" />
        </div>

        {/* BOTTOM: keep quotes / QR section as previous */}
        <div className="col-span-12 h-35 max-[1750px]:h-15">
          <QuotesSection quotes={quotes} />
        </div>
      </div>
    </div>
  );
}
