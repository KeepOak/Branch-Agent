import { describe, expect, it, vi } from "vitest";
import { fetchWeather, geocodeCity, mapWmoCode } from "./weather-api.js";

describe("weather tool helpers", () => {
  describe("optional daily bounds", () => {
    const current = { temperature_2m: 2, relative_humidity_2m: 50, apparent_temperature: 1, weather_code: 0, wind_speed_10m: 0, precipitation: 0, is_day: 1 };
    const geocoding = { results: [{ name: "Fixture city", latitude: 1, longitude: 2, country: "Fixture country", timezone: "UTC" }] };
    it.each([
      ["empty", []],
      ["non-finite", [Number.NaN]],
      ["unavailable", [null]],
    ])("omits %s daily bounds instead of inventing temperatures", async (_label, values) => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => geocoding })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ current, daily: { temperature_2m_max: values, temperature_2m_min: values } }) }));
      try {
        const result = await fetchWeather("Fixture city");
        expect(result.high).toBeUndefined();
        expect(result.low).toBeUndefined();
        expect(result.temperature).toBe("2°C");
      } finally { vi.unstubAllGlobals(); }
    });
    it("preserves valid zero Celsius bounds", async () => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => geocoding })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ current, daily: { temperature_2m_max: [0], temperature_2m_min: [0] } }) }));
      try {
        const result = await fetchWeather("Fixture city");
        expect(result.high).toBe("0°C");
        expect(result.low).toBe("0°C");
      } finally { vi.unstubAllGlobals(); }
    });
  });
  describe("mapWmoCode", () => {
    it("maps clear sky during day", () => {
      const result = mapWmoCode(0, false);
      expect(result.conditionCode).toBe("clear-day");
      expect(result.condition).toBe("Clear sky");
    });

    it("maps clear sky at night to clear-night", () => {
      const result = mapWmoCode(0, true);
      expect(result.conditionCode).toBe("clear-night");
    });

    it("maps partly cloudy at night", () => {
      const result = mapWmoCode(2, true);
      expect(result.conditionCode).toBe("partly-cloudy-night");
    });

    it("maps rain codes", () => {
      expect(mapWmoCode(61, false).conditionCode).toBe("rain");
      expect(mapWmoCode(65, false).conditionCode).toBe("extreme-rain");
    });

    it("maps snow codes", () => {
      expect(mapWmoCode(71, false).conditionCode).toBe("snow");
      expect(mapWmoCode(75, false).conditionCode).toBe("extreme-snow");
    });

    it("maps thunderstorm", () => {
      expect(mapWmoCode(95, false).conditionCode).toBe("thunderstorm");
      expect(mapWmoCode(99, false).conditionCode).toBe("thunderstorm");
    });

    it("maps fog", () => {
      expect(mapWmoCode(45, false).conditionCode).toBe("fog");
      expect(mapWmoCode(48, false).conditionCode).toBe("fog");
    });

    it("maps drizzle", () => {
      expect(mapWmoCode(51, false).conditionCode).toBe("drizzle");
    });

    it("maps sleet / freezing", () => {
      expect(mapWmoCode(56, false).conditionCode).toBe("sleet");
      expect(mapWmoCode(66, false).conditionCode).toBe("sleet");
    });

    it("falls back to clear-day for unknown codes", () => {
      expect(mapWmoCode(999, false).conditionCode).toBe("clear-day");
      expect(mapWmoCode(999, false).condition).toBe("Unknown");
    });

    it("does not apply night variant for non-day conditions", () => {
      const result = mapWmoCode(95, true);
      expect(result.conditionCode).toBe("thunderstorm");
    });
  });

  describe("geocodeCity", () => {
    it("throws on empty results", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        }),
      );

      await expect(geocodeCity("NonexistentCity")).rejects.toThrow("City not found");

      vi.unstubAllGlobals();
    });

    it("returns first result", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  name: "Tokyo",
                  latitude: 35.68,
                  longitude: 139.69,
                  country: "Japan",
                  timezone: "Asia/Tokyo",
                },
              ],
            }),
        }),
      );

      const result = await geocodeCity("Tokyo");
      expect(result.name).toBe("Tokyo");
      expect(result.country).toBe("Japan");

      vi.unstubAllGlobals();
    });

    it("throws on HTTP error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      await expect(geocodeCity("Tokyo")).rejects.toThrow("Geocoding request failed: 500");

      vi.unstubAllGlobals();
    });
  });
});
