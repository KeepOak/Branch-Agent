import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather } from "./weather-api.js";
import { createWeatherTool } from "./weather-tool.js";

const geo = { results: [{ name: "Tokyo", latitude: 35.68, longitude: 139.69, country: "Japan" }] };
const forecast = {
  current: {
    temperature_2m: 20.4,
    relative_humidity_2m: 60,
    apparent_temperature: 19.7,
    weather_code: 2,
    wind_speed_10m: 8.7,
    precipitation: 0,
    is_day: 0,
  },
  daily: { temperature_2m_max: [24.3], temperature_2m_min: [15.6] },
};
describe("weather backend adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("executes geocoding then forecast and returns source summary/data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(geo)))
      .mockResolvedValueOnce(new Response(JSON.stringify(forecast)));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const result = await createWeatherTool().execute(
      "weather",
      { city: "Tokyo & suburbs" },
      signal,
    );
    expect(fetcher.mock.calls[0][0]).toContain("Tokyo%20%26%20suburbs");
    const url = new URL(fetcher.mock.calls[1][0]);
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("35.68");
    expect(url.searchParams.get("forecast_days")).toBe("1");
    expect(fetcher.mock.calls.map((call) => call[1])).toEqual([{ signal }, { signal }]);
    expect(result.details).toMatchObject({
      city: "Tokyo",
      country: "Japan",
      temperature: "20°C",
      conditionCode: "partly-cloudy-night",
      high: "24°C",
      low: "16°C",
    });
    expect(result.content[0].text).toContain("Weather in Tokyo, Japan");
  });
  it("propagates API errors without weather success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(geo)))
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 })),
    );
    await expect(createWeatherTool().execute("weather", { city: "Tokyo" })).rejects.toThrow(
      "Weather request failed: 503",
    );
  });
  it("keeps daily values optional", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(geo)))
        .mockResolvedValueOnce(new Response(JSON.stringify({ current: forecast.current }))),
    );
    expect(await fetchWeather("Tokyo")).toMatchObject({ high: undefined, low: undefined });
  });
  it("rejects invalid input before any network request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(createWeatherTool().execute("weather", { city: 1 })).rejects.toThrow(
      "city must be a string",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
