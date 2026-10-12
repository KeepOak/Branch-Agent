/** Backend adapter of moeru-ai/airi@4b702bd6678def26b046a958c90dbdbe5c003b87, weather.ts.
 * The structured result is portable; widget presentation belongs to the client. */
import type { TSchema } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { fetchWeather } from "./weather-api.js";

export function createWeatherTool(): AnyAgentTool {
  return {
    name: "get_weather",
    label: "Weather",
    description:
      "Get current weather for a city. Returns a weather summary and structured weather data.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: 'City name to get weather for, e.g. "Tokyo", "New York", "London"',
        },
      },
      required: ["city"],
    } as TSchema,
    async execute(_id, input, signal) {
      if (
        !input ||
        typeof input !== "object" ||
        !("city" in input) ||
        typeof input.city !== "string"
      ) {
        throw new Error("city must be a string");
      }
      const weather = await fetchWeather(input.city, signal);
      return {
        content: [
          {
            type: "text",
            text: `Weather in ${weather.city}, ${weather.country}: ${weather.temperature}, ${weather.condition}. Feels like ${weather.feelsLike}. Humidity ${weather.humidity}, Wind ${weather.wind}.`,
          },
        ],
        details: weather,
      };
    },
  };
}
