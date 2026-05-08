import { useEffect, useState } from "react";
import QRCodeModule from "react-qr-code";

const QRCodeComponent =
  QRCodeModule?.default || QRCodeModule?.QRCode || QRCodeModule;

// Easy timing control
const QUOTE_ROTATION_MS = 5000; // each message duration
const QR_PROMPT_EVERY_MS = 20000; // show CTA every 20 seconds
const QR_PROMPT_DURATION_MS = 5000; // CTA stays for 5 seconds

export default function QuotesSection({ quotes = [] }) {
  const [index, setIndex] = useState(0);
  const [showQrPrompt, setShowQrPrompt] = useState(false);
  const [qrSize, setQrSize] = useState(100);

  const hasQuotes = Array.isArray(quotes) && quotes.length > 0;

  // Rotate submitted quotes
  useEffect(() => {
    if (!hasQuotes) return;

    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % quotes.length);
    }, QUOTE_ROTATION_MS);

    return () => clearInterval(interval);
  }, [hasQuotes, quotes.length]);

  // Show QR instruction repeatedly, even when quotes exist
  useEffect(() => {
    if (!hasQuotes) {
      setShowQrPrompt(true);
      return;
    }

    setShowQrPrompt(false);

    const interval = setInterval(() => {
      setShowQrPrompt(true);

      const timeout = setTimeout(() => {
        setShowQrPrompt(false);
      }, QR_PROMPT_DURATION_MS);

      return () => clearTimeout(timeout);
    }, QR_PROMPT_EVERY_MS);

    return () => clearInterval(interval);
  }, [hasQuotes]);

  // QR responsive size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1750) {
        setQrSize(60);
      } else {
        setQrSize(100);
      }
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const currentQuote = hasQuotes ? quotes[index % quotes.length] : null;

  const submitUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/StudioPLT/PLT-OP-LP/Message`
      : "/StudioPLT/PLT-OP-LP/Message";

  const shouldShowPrompt = showQrPrompt || !currentQuote;

  return (
    <div className="h-full w-full rounded-3xl">
      <div className="flex h-full items-stretch gap-2">
        <div className="flex h-full flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/10 px-8 py-4 text-center backdrop-blur-md">
          {shouldShowPrompt ? (
            <div>
              <div className="max-[1750px]:text-lg text-2xl font-medium text-white/70">
                Scan QR Code to Share a Motivational Message with your Pilates
                Community
              </div>
            </div>
          ) : (
            <div>
              <div className="text-2xl font-medium leading-relaxed text-white">
                “{currentQuote.quote}”
              </div>
              <div className="max-[1750px]:mt-0 mt-3 max-[1750px]:text-sm text-md text-white/60">
                — {currentQuote.displayName || "Anonymous"}
              </div>
            </div>
          )}
        </div>

        <div className="flex h-full flex-col items-center justify-center rounded-2xl text-center">
          <div className="flex items-center justify-center rounded-xl">
            <QRCodeComponent value={submitUrl} size={qrSize} />
          </div>
        </div>
      </div>
    </div>
  );
}
