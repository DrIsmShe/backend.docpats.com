export function generatePrognosis(profile) {
  let hospitalizationRisk = 0;
  let deteriorationRisk = 0;

  if (profile.symptoms?.includes("dyspnea")) deteriorationRisk += 0.25;

  if (profile.labs?.CRP > 10) deteriorationRisk += 0.35;

  if (profile.age > 65) hospitalizationRisk += 0.2;

  if (profile.conditions?.includes("hypertension")) hospitalizationRisk += 0.15;

  return [
    {
      target: "hospitalization_30d",
      probability: Math.min(hospitalizationRisk, 1),
      level: hospitalizationRisk > 0.5 ? "high" : "moderate",
      confidence: 0.72,
    },
    {
      target: "deterioration_72h",
      probability: Math.min(deteriorationRisk, 1),
      level: deteriorationRisk > 0.5 ? "high" : "moderate",
      confidence: 0.74,
    },
  ];
}
