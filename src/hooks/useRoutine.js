import { useEffect, useState } from "react";
import { API_BASE } from "../utils/api";

function getTodayWeekday() {
  return new Date()
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();
}

function buildDateTimeForToday(startTime) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return new Date(`${year}-${month}-${day} ${startTime}`);
}

function buildEndTime(startDate, durationMinutes) {
  return new Date(startDate.getTime() + durationMinutes * 60 * 1000);
}

export default function useRoutine() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchRoutine = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sheets?type=routine`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const rawClasses = Array.isArray(data) ? data : data?.classes || [];

        const today = getTodayWeekday();
        const now = new Date();

        const todayClasses = rawClasses
          .filter(
            (item) => String(item.dayOfWeek || "").toLowerCase() === today,
          )
          .map((item) => {
            const start = buildDateTimeForToday(item.startTime);
            const end = buildEndTime(start, item.duration);
            return {
              ...item,
              start: start.toISOString(),
              end: end.toISOString(),
            };
          })
          .filter((item) => new Date(item.end) > now) // Only current or upcoming
          .sort((a, b) => new Date(a.start) - new Date(b.start)); // Earliest first

        setClasses(todayClasses);
        setError("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchRoutine();
    const interval = setInterval(fetchRoutine, 60 * 10000);
    return () => clearInterval(interval);
  }, []);

  return { classes, loading, error };
}
