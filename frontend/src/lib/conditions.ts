import type { Condition } from "../api/types";

/** Every model the app can show, in display order. */
export const CONDITIONS: Condition[] = ["diabetes", "diabetes_survey", "heart_disease"];

export const CONDITION_NAME: Record<Condition, string> = {
  diabetes: "Diabetes",
  diabetes_survey: "Diabetes (lifestyle survey)",
  heart_disease: "Heart disease",
};

export const CONDITION_HINT: Record<Condition, string> = {
  diabetes: "Uses a 2-hour glucose test value, blood pressure, BMI, age and pregnancies.",
  diabetes_survey: "Uses lifestyle and health answers, no lab test. Trained on 253,000 US survey respondents.",
  heart_disease: "Uses blood pressure, cholesterol and clinic test results.",
};

export const isCondition = (v: string | undefined): v is Condition => !!v && (CONDITIONS as string[]).includes(v);
