import { useEffect, useState } from "react";

const BASE_PATH = "/BruCafe/PLT-OP-LP/Layer1";
const REDIRECT_SECONDS = 5;

export default function NotFound() {
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    const redirectTimer = setTimeout(() => {
      window.location.href = BASE_PATH;
    }, REDIRECT_SECONDS * 1000);

    const countdownTimer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(redirectTimer);
      clearInterval(countdownTimer);
    };
  }, []);

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-black px-6 text-white">
      {/* background glow */}
      <div className="absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/10 blur-3xl animate-pulse" />
        <div className="absolute left-[42%] top-[46%] h-[280px] w-[280px] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* content */}
      <div className="relative w-full max-w-2xl rounded-[28px] border border-white/10 bg-white/5 p-10 text-center backdrop-blur-xl">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 text-5xl font-bold text-red-400 shadow-[0_0_40px_rgba(239,68,68,0.18)]">
          404
        </div>

        <h1 className="text-4xl font-bold tracking-tight">Page Not Found</h1>

        <p className="mx-auto mt-4 max-w-xl text-lg text-white/65">
          The link you opened is invalid, unavailable, or no longer active for
          this display.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 px-5 py-4">
          <div className="text-sm uppercase tracking-[0.2em] text-white/40">
            Redirecting
          </div>
          <div className="mt-2 text-2xl font-semibold">
            Returning to main screen in{" "}
            <span className="text-red-400">{secondsLeft}</span>s
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            onClick={() => {
              window.location.href = BASE_PATH;
            }}
            className="rounded-xl bg-white px-6 py-3 font-semibold text-black transition hover:scale-[1.02]"
          >
            Go to Main Screen
          </button>

          <button
            onClick={() => {
              window.history.back();
            }}
            className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
