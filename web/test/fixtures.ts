import type { CaseView } from "../src/types";

export function caseView(over: Partial<CaseView> = {}): CaseView {
  return {
    id: "2026-10-22-abcdef01",
    createdAt: "2026-10-22T08:00:00.000Z",
    expert: "Божидар Василев",
    status: "read",
    photos: ["001-p.jpg", "002-p.jpg"],
    facts: { fire_date: "2026-05-14", place: "Плевен" },
    numbers: [
      { file: "001-p.jpg", value: "1,4", context: "височина на контейнера, м" },
      { file: "002-p.jpg", value: "3", context: "страница от протокола" },
    ],
    history: [],
    files: [],
    costUsd: 0.013,
    lastEventId: 14,
    progress: null,
    ...over,
  };
}
