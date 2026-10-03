import type { CanopyCard } from "@branch/canopy-contract";
import type { Locator } from "playwright";

export const expectedMobileScrollGeometry = {
  contentScrolls: true,
  lastCardIsClipped: true,
};

export function createMobileScrollCards(now: number): CanopyCard[] {
  return Array.from({ length: 6 }, (_, index) => ({
    createdAt: now,
    id: `mobile-card-${index + 1}`,
    labels: [],
    notes: "",
    position: 1000,
    priority: "normal",
    status: "todo",
    title: `Mobile canopy card ${index + 1}`,
    updatedAt: now,
  }));
}

export async function readMobileScrollGeometry(content: Locator, cardTitle: string) {
  return content.evaluate((scrollContainer, expectedTitle) => {
    const card = Array.from(scrollContainer.querySelectorAll<HTMLElement>(".canopy-card")).find(
      (candidate) => candidate.textContent?.includes(expectedTitle),
    );
    if (!card) {
      throw new Error("Mobile Canopy geometry fixture did not render");
    }
    return {
      contentScrolls: scrollContainer.scrollHeight > scrollContainer.clientHeight + 1,
      lastCardIsClipped:
        card.getBoundingClientRect().bottom > scrollContainer.getBoundingClientRect().bottom,
    };
  }, cardTitle);
}

export async function cardFitsWithinCanopyContent(card: Locator) {
  return card.evaluate((element) => {
    const content = element.closest<HTMLElement>(".canopy-column__cards");
    if (!content) {
      throw new Error("Mobile Canopy column scroll container is missing");
    }
    const contentRect = content.getBoundingClientRect();
    const cardRect = element.getBoundingClientRect();
    return cardRect.top >= contentRect.top && cardRect.bottom <= contentRect.bottom + 1;
  });
}
