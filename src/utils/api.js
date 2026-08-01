export const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3002"
    : import.meta.env.BASE_URL.replace(/\/$/, "");
