import { i18n } from "../../../i18n/index.ts";
import type { TranslationMap } from "../../../i18n/lib/types.ts";
import { en } from "../../../i18n/locales/en.ts";
import type { renderRings } from "./view.ts";

export const fullRingsViewAccess: Parameters<typeof renderRings>[0]["access"] = {
  canOpenConfig: true,
  canBackfillDiary: true,
  canDedupeDreamDiary: true,
  canResetDiary: true,
  canResetGroundedShortTerm: true,
  canRepairRingsArtifacts: true,
};

const asTranslationMap = (value: string | TranslationMap | undefined): TranslationMap =>
  value && typeof value === "object" ? value : {};

export function installRingsViewTestTranslations(): () => void {
  const rings = asTranslationMap(en.rings);
  const wiki = asTranslationMap(rings.wiki);
  i18n.registerTranslation("en", {
    ...en,
    rings: {
      ...rings,
      wiki: {
        ...wiki,
        pageTypes: {
          entity: "entity",
          concept: "concept",
          source: "source",
          synthesis: "synthesis",
          report: "report",
        },
        pageGroups: {
          sources: "Sources",
          syntheses: "Syntheses",
          reports: "Reports",
          entities: "Entities",
          concepts: "Concepts",
        },
        counts: {
          pageOne: "{count} page",
          pages: "{count} pages",
          claimRowOne: "{count} claim row",
          claimRows: "{count} claim rows",
          openQuestionOne: "{count} open question",
          openQuestions: "{count} open questions",
          contradictionOne: "{count} contradiction",
          contradictions: "{count} contradictions",
          chats: "{count} chats",
          sensitive: "{count} sensitive",
          signals: "{count} signals",
          messages: "{count} messages",
          userMessages: "{count} user",
          assistantMessages: "{count} assistant",
        },
        pageGroupSummary: "{label} · {count}",
        noPagesYet: "No pages yet",
        sectionPageSummary: "{label}: {count}",
        questionCountOnPages: "{questionCount} on {pageCount}",
        risk: {
          needsReview: "needs review",
          low: "low risk",
          medium: "medium risk",
          high: "high risk",
          unknown: "unknown risk",
        },
        pageNotFound: "No wiki page found for {lookup}.",
        previewTruncated: "Showing the first chunk of this page.",
        previewTruncatedWithTotal: "Showing the first chunk of this page ({count} total lines).",
        importedClusterSummary: "Imported chats clustered around {label}.",
        withheldDigestOne: "{count} digest was withheld pending review.",
        withheldDigests: "{count} digests were withheld pending review.",
        details: "Details",
        hideDetails: "Hide details",
        vault: "Vault",
        fullVaultBreakdown: "Full vault breakdown: {breakdown}.",
        selectedSection: "Selected section: {summary}.",
        latestUpdate: "Latest update {date}.",
      },
    },
  });
  return () => i18n.registerTranslation("en", en);
}
