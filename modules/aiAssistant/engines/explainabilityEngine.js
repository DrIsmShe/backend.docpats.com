export function generateExplainability(profile) {
  const factors = [];

  if (profile.labs?.CRP > 10) {
    factors.push({
      factor: "Elevated CRP",
      influence: "increase",
      strength: 0.82,
    });
  }

  if (profile.symptoms?.includes("dyspnea")) {
    factors.push({
      factor: "Dyspnea",
      influence: "increase",
      strength: 0.76,
    });
  }

  if (profile.age > 65) {
    factors.push({
      factor: "Age > 65",
      influence: "increase",
      strength: 0.6,
    });
  }

  return {
    topFactors: factors,
  };
}
