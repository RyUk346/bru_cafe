import { useEffect, useState } from "react";
import { API_BASE } from "../utils/api";

export default function useLeaderboard() {
  const [leaders, setLeaders] = useState([]);
  const [heading, setHeading] = useState("");
  const [subheading, setSubheading] = useState("");
  const [milestones, setMilestones] = useState({
    gold: 40,
    silver: 25,
    bronze: 10,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sheets?type=leaderboard`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load leaderboard");
        }

        setHeading(data.heading || "");
        setSubheading(data.subheading || "");
        setLeaders(data.leaders || []);
        setMilestones(
          data.milestones || {
            gold: 40,
            silver: 25,
            bronze: 10,
          },
        );
        setError("");
      } catch (err) {
        setError(err.message || "Failed to load leaderboard");
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();

    const interval = setInterval(fetchLeaderboard, 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    leaders,
    heading,
    subheading,
    milestones,
    loading,
    error,
  };
}
