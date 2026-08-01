import { useEffect, useMemo, useState } from "react";

const ITEMS_PER_PAGE = 9;
const SLIDE_INTERVAL_MS = 10000;

function capitalize(word = "") {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatMemberName(name = "") {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "";

  if (parts.length === 1) {
    return capitalize(parts[0]);
  }

  const firstName = capitalize(parts[0]);
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() || "";

  return `${firstName} ${lastInitial}`;
}

function getTier(visits = 0, milestones = {}) {
  const count = Number(visits) || 0;

  const gold = Number(milestones.gold || 40);
  const silver = Number(milestones.silver || 25);
  const bronze = Number(milestones.bronze || 10);

  if (count >= gold) {
    return {
      label: `${gold}+ Club`,
      cardBg: "border-white/20 bg-[#FFD70014]",
      badgeBg: "bg-[#FFD70040] text-yellow-300 border border-yellow-400/30",
      textColor: "text-[#FFD700]",
    };
  }

  if (count >= silver) {
    return {
      label: `${silver}+ Club`,
      cardBg: "border-white/20 bg-[#C0C0C014]",
      badgeBg: "bg-[#C0C0C040] text-slate-50 border border-slate-300/30",
      textColor: "text-slate-50",
    };
  }

  if (count >= bronze) {
    return {
      label: `${bronze}+ Club`,
      cardBg: "border-white/20 bg-[#CD7F3214]",
      badgeBg: "bg-[#CD7F3240] text-orange-300 border border-orange-400/30",
      textColor: "text-[#CD7F32]",
    };
  }

  return {
    label: `${bronze}+ Club`,
    cardBg: "border-white/20 bg-[#CD7F3214]",
    badgeBg: "bg-[#CD7F3240] text-orange-300 border border-orange-400/30",
    textColor: "text-[#CD7F32]",
};
}

export default function SlidingLeaderboard({ leaders, milestones }) {
  const pages = useMemo(() => {
    const chunks = [];

    const bronze = Number(milestones?.bronze || 10);

const clubMembers = leaders.filter((item) => {
  const visits = Number(item.visits || 0);
  return visits >= bronze;
});

for (let i = 0; i < clubMembers.length; i += ITEMS_PER_PAGE) {
  chunks.push(clubMembers.slice(i, i + ITEMS_PER_PAGE));
}

    return chunks;
  }, [leaders, milestones]);

  const [pageIndex, setPageIndex] = useState(0);
  const [animateCards, setAnimateCards] = useState(true);

  useEffect(() => {
    if (pages.length <= 1) return;

    const interval = setInterval(() => {
      setAnimateCards(false);

      setTimeout(() => {
        setPageIndex((prev) => (prev + 1) % pages.length);
        setAnimateCards(true);
      }, 100);
    }, SLIDE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pages.length]);

  useEffect(() => {
    setAnimateCards(false);

    const timeout = setTimeout(() => {
      setAnimateCards(true);
    }, 80);

    return () => clearTimeout(timeout);
  }, [pageIndex]);

  return (
    <div className="relative h-full  mt-1 overflow-hidden">
      <div
        className="h-full transition-transform duration-700 ease-in-out"
        style={{ transform: `translateY(-${pageIndex * 100}%)` }}
      >
        {pages.map((page, idx) => (
          <div key={idx} className="h-full space-y-3 max-[1750px]:space-y-1">
            {page.map((item, itemIndex) => {
              const tier = getTier(item.visits, milestones);
              const isActivePage = idx === pageIndex;

              return (
                <div
                  key={`${item.name}-${item.visits}`}
                  className={`rounded-2xl flex flex-col justify-center border px-4 py-4 backdrop-blur-md transition-all duration-700 ease-out max-[1750px]:py-2 ${tier.cardBg} ${
                    isActivePage && animateCards
                      ? "translate-x-0 opacity-100"
                      : "-translate-x-10 opacity-0"
                  }`}
                  style={{
                    transitionDelay:
                      isActivePage && animateCards
                        ? `${itemIndex * 180}ms`
                        : "0ms",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className={`text-2xl font-semibold leading-tight max-[1750px]:text-lg max-[1750px]:font-medium ${tier.textColor}`}
                    >
                      {formatMemberName(item.name)}
                    </div>

                    <div
                      className={`rounded-full px-3 py-0.5 text-lg max-[1750px]:text-xs ${tier.badgeBg}`}
                    >
                      {tier.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
