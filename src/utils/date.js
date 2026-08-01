export const formatTime = (dateString) => {
  const date = new Date(dateString);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes <= 0) {
    return "1m";
  }

  return `${minutes}m`;
};

// Google-style relative time for review timestamps (ms since epoch):
// "just now", "an hour ago", "5 hours ago", "a day ago", "2 days ago",
// "a week ago", "3 weeks ago", "a month ago", "a year ago", ...
export const timeAgo = (timestampMs, now = Date.now()) => {
  const ms = Number(timestampMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";

  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  if (days < 7) return days === 1 ? "a day ago" : `${days} days ago`;
  if (days < 30) return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  if (days < 365) return months <= 1 ? "a month ago" : `${months} months ago`;
  return years <= 1 ? "a year ago" : `${years} years ago`;
};

export const getClassTimingState = (
  startString,
  endString,
  now = new Date(),
) => {
  const start = new Date(startString);
  const end = new Date(endString);

  if (now < start) {
    return {
      state: "scheduled",
      label: `Starts in ${formatDuration(start - now)}`,
    };
  }

  if (now >= start && now < end) {
    return {
      state: "live",
      label: `Ends in ${formatDuration(end - now)}`,
    };
  }

  return {
    state: "finished",
    label: "Finished",
  };
};
