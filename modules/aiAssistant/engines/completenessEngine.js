export function calculateCompleteness(profile) {
  const requiredFields = ["symptoms", "labs", "conditions", "imaging"];

  let present = 0;

  requiredFields.forEach((field) => {
    if (profile[field] && profile[field].length !== 0) present++;
  });

  return present / requiredFields.length;
}
