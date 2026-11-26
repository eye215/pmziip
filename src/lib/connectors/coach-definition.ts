// Definition only: no client credentials, live property, API call or scheduled collection.
export const coachDefinition = {
  version: "coach-ga4-1.2",
  main: { eventName: "screen_view", screenDimension: "unifiedScreenName", screenName: "GALAXY_COACH_SCREEN", metrics: ["totalUsers", "eventCount"] },
  start: { eventName: "GALAXY_COACH_SIMULATION", metrics: ["totalUsers", "eventCount"] },
  done: { eventName: "GALAXY_COACH_REPORT", metrics: ["totalUsers", "eventCount"] },
  score: { eventName: "GALAXY_COACH_REPORT", dimension: "customEvent:nsp_value", allowedValues: ["1", "2", "3", "4", "5"], metric: "eventCount" },
  countryDimension: "countryId",
  salesCaseDimension: "customEvent:nsp_category",
  salesCases: ["switcher", "upgrader", "retention"],
  doneCountSource: "reportEventCount",
  validScoreCountSource: "scoreEventCount",
  uniqueUsersPolicy: "query-period-total-separately",
} as const;
