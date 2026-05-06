import { useState, useEffect, useMemo } from "react";
import useRoutine from "../hooks/useRoutine";
import SlidingLeaderboard from "./SlidingLeaderboard";
import useLeaderboard from "../hooks/useLeaderboard";
import useQuotes from "../hooks/useQuotes";
import QuotesSection from "./QuotesSection";
import { getClassTimingState } from "../utils/date";
import WeatherWidget from "./WeatherWidget";
import useWeather from "../hooks/useWeather";

export default function ScheduleBoard() {
  const weather = useWeather();
  const { classes, loading, error } = useRoutine();
  // const {
  //   leaders,
  //   heading: leaderboardHeading,
  //   subheading: leaderboardSubheading,
  //   milestones,
  //   loading: leaderLoading,
  //   error: leaderError,
  // } = useLeaderboard();
  const { quotes } = useQuotes();

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

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

  const selectedClass = useMemo(() => {
    if (!classes?.length) return null;

    const liveClass = classes.find((item) => {
      const timing = getClassTimingState(item.start, item.end, now);
      return timing.state === "live";
    });

    if (liveClass) return liveClass;

    return classes[0] || null;
  }, [classes, now]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-3xl text-white">
        Loading today’s class schedule...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-2xl text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden p-2 text-white">
      <div className="grid h-full grid-cols-12 gap-2">
        <div className="col-span-2 flex h-[84vh] flex-col overflow-hidden rounded-lg bg-black/30 p-6 backdrop-blur-md max-[1750px]:px-4 py-2">
          <div className="border-b border-white/50 pb-4 max-[1750px]:pb-2">
            <h2 className="text-4xl font-bold tracking-wide max-[1750px]:text-2xl">
              {/* {leaderboardHeading} */}
            </h2>
            <p className="mt-1 text-lg text-white/60 font-semibold max-[1750px]:text-sm">
              {/* {leaderboardSubheading} */}
            </p>
          </div>

          {/* <div className="mt-6 flex-1 overflow-hidden max-[1750px]:mt-3">
            {leaderLoading ? (
              <div className="text-white/70">Loading leaderboard...</div>
            ) : leaderError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-4 text-red-300">
                {leaderError}
              </div>
            ) : leaders.length === 0 ? (
              <div className="text-white/70">No leaderboard data found</div>
            ) : (
              <SlidingLeaderboard leaders={leaders} milestones={milestones} />
            )}
          </div> */}
        </div>

        <div className="col-span-10 flex h-full flex-col">
          <div className="flex h-35 max-[1750px]:h-18 justify-end rounded-lg backdrop-blur-md ">
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
                <div className=" text-3xl font-bold tabular-nums text-white max-[1750px]:text-xl">
                  {currentTime}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1" />
        </div>
        <div className="col-span-12 h-35 max-[1750px]:h-15">
          <QuotesSection quotes={quotes} />
        </div>
      </div>
    </div>
  );
}
