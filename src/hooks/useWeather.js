import { useEffect, useState } from "react";

import sunnyDay from "../assets/weather/Sunny.png";
import clearNight from "../assets/weather/clear-night.png";
import partlyCloudyDay from "../assets/weather/partlyCloud_day.png";
import partlyCloudyNight from "../assets/weather/partlyCloud_day.png";
import cloudy from "../assets/weather/cloudy.png";
import fog from "../assets/weather/Snow.png";
import drizzle from "../assets/weather/drizzle.png";
import rain from "../assets/weather/rain.png";
import snow from "../assets/weather/Snow.png";
import thunderstorm from "../assets/weather/thunderstorm.png";
import fallback from "../assets/weather/default.png";

const lat = import.meta.env.VITE_WEATHER_LAT;
const lon = import.meta.env.VITE_WEATHER_LON;

const WEATHER_API_URL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&timezone=auto`;
function isDayTime(sunrise, sunset) {
  const now = new Date();
  const sunriseTime = new Date(sunrise);
  const sunsetTime = new Date(sunset);

  return now >= sunriseTime && now < sunsetTime;
}

function getWeatherMeta(code, temp, isDay) {
  const temperature = Number(temp);

  if (code === 0) {
    if (isDay) {
      return { icon: sunnyDay, label: temperature >= 15 ? "Sunny" : "Clear" };
    }

    return { icon: clearNight, label: "Clear" };
  }

  if ([1, 2].includes(code)) {
    return {
      icon: isDay ? partlyCloudyDay : partlyCloudyNight,
      label: "Partly cloudy",
    };
  }

  if (code === 3) {
    return { icon: cloudy, label: "Cloudy" };
  }

  if ([45, 48].includes(code)) {
    return { icon: fog, label: "Fog" };
  }

  if ([51, 53, 55, 56, 57].includes(code)) {
    return { icon: drizzle, label: "Drizzle" };
  }

  if ([61, 63, 65, 80, 81, 82, 66, 67].includes(code)) {
    return { icon: rain, label: "Rain" };
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { icon: snow, label: "Snow" };
  }

  if ([95, 96, 99].includes(code)) {
    return { icon: thunderstorm, label: "Thunderstorm" };
  }

  return { icon: fallback, label: "Weather" };
}

export default function useWeather() {
 const [weather, setWeather] = useState({
  temperature: null,
  maxTemperature: null,
  minTemperature: null,
  icon: fallback,
  label: "Loading",
  loading: true,
  error: "",
  isDay: true,
});

  useEffect(() => {
    let isMounted = true;

    const fetchWeather = async () => {
      try {
        const res = await fetch(WEATHER_API_URL);

        if (!res.ok) {
          throw new Error(`Weather request failed: ${res.status}`);
        }

        const data = await res.json();
        const current = data?.current;
        const sunrise = data?.daily?.sunrise?.[0];
        const sunset = data?.daily?.sunset?.[0];
        const maxTemperature = data?.daily?.temperature_2m_max?.[0];
        const minTemperature = data?.daily?.temperature_2m_min?.[0];

        if (
          !current ||
          current.temperature_2m == null ||
          current.weather_code == null ||
          !sunrise ||
          !sunset ||
          maxTemperature == null ||
          minTemperature == null
        ) {
          throw new Error("Incomplete weather data");
        }

        const isDay = isDayTime(sunrise, sunset);

        const meta = getWeatherMeta(
          current.weather_code,
          current.temperature_2m,
          isDay,
        );

        if (isMounted) {
          setWeather({
          temperature: Math.round(current.temperature_2m),
          maxTemperature: Math.round(maxTemperature),
          minTemperature: Math.round(minTemperature),
          icon: meta.icon,
          label: meta.label,
          loading: false,
          error: "",
          isDay,
        });
        }
      } catch (error) {
        if (isMounted) {
          setWeather((prev) => ({
            ...prev,
            loading: false,
            error: error.message || "Unable to load weather",
          }));
        }
      }
    };

    fetchWeather();

    const interval = setInterval(fetchWeather, 10 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return weather;
}