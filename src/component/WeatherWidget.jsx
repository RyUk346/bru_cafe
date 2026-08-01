export default function WeatherWidget({
  temperature,
  maxTemperature,
  minTemperature,
  icon,
  label,
  loading,
  error,
}) {
  return (
    <div className="flex h-full min-w-[120px] flex-col items-center justify-center rounded-lg border border-white/10 bg-black/10 px-4 py-4 text-center backdrop-blur-md max-[1750px]:min-w-[100px] max-[1750px]:px-3">
      {loading ? (
        <>
          <div className="text-2xl max-[1750px]:text-xl">🌡️</div>
          <div className="mt-1 text-lg font-semibold text-white max-[1750px]:text-sm">
            --°
          </div>
          <div className="text-xs text-white/60">Loading</div>
        </>
      ) : error ? (
        <>
          <div className="text-2xl max-[1750px]:text-xl">⚠️</div>
          <div className="mt-1 text-sm font-medium text-white/80">Weather</div>
          <div className="text-xs text-red-300">Unavailable</div>
          {error && typeof error === "string" ? (
            <div className="mt-1 max-w-[140px] text-[10px] leading-tight text-red-300/70">
              {error}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div>
              <img
                src={icon}
                alt={label}
                className="h-18 w-18 object-contain -mt-3 max-[1750px]:h-16 max-[1750px]:w-16"
              />
            </div>

            <div className="">
              <div className="mt-1 text-3xl font-bold text-white text-left">
                {temperature}°C
              </div>
            </div>
            <div className="mt-1 text-sm font-semibold text-left text-white/70 text-right pl-3">
              <div className="text-white/60 ">{label}</div>
              {maxTemperature}° / {minTemperature}°
            </div>
          </div>
        </>
      )}
    </div>
  );
}
