"""Central configuration for the HealthTwin ML pipeline.

Everything the backend, simulator and UI need to know about a model's inputs lives here, so
validation, the What-If editor and the model card can never drift apart.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
ARTIFACT_DIR = ROOT / "artifacts"

SEED = 42
TEST_SIZE = 0.20
CV_FOLDS = 5
N_BOOTSTRAP = 20            # bootstrap members used for the Trust Meter uncertainty range
SHAP_BACKGROUND_ROWS = 30
LR_PREFERENCE_MARGIN = 0.01  # prefer the simpler Logistic Regression unless RF beats it by more than this (CV ROC-AUC)

# Presentation bands for the gauge. These are a UI convention, NOT clinical thresholds.
RISK_BAND_EDGES = (0.20, 0.50)  # <0.20 low, <0.50 moderate, otherwise high

CATEGORICAL_COLUMNS = frozenset({"cp", "restecg", "slope", "thal"})


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    unit: str
    kind: str                      # continuous | integer | binary | categorical
    min: float
    max: float
    editable: bool = False         # may the What-If Simulator change it?
    categories: tuple = ()


@dataclass(frozen=True)
class Condition:
    key: str
    title: str
    dataset: str
    raw_file: str
    outcome_definition: str
    population_note: str
    features: tuple                # the PRIMARY feature set the deployed model uses
    sensitivity_sets: dict         # name -> list of columns, compared by CV on training data only


DIABETES = Condition(
    key="diabetes",
    title="Diabetes",
    dataset="Pima Indians Diabetes Database (NIDDK)",
    raw_file="pima.csv",
    outcome_definition="Diabetes diagnosis recorded in the dataset (WHO criteria), not future onset.",
    population_note=(
        "Training data covers 768 women aged 21-81 of Pima Indian heritage. Estimates for men, other "
        "ethnic groups or ages outside 21-81 are outside what the data represents."
    ),
    features=(
        Feature("pregnancies", "Pregnancies", "count", "integer", 0, 20),
        Feature("glucose", "2-hour plasma glucose (oral glucose tolerance test)", "mg/dL", "continuous", 40, 400, editable=True),
        Feature("blood_pressure", "Diastolic blood pressure", "mmHg", "continuous", 30, 130, editable=True),
        Feature("bmi", "Body mass index", "kg/m2", "continuous", 12, 70, editable=True),
        Feature("age", "Age", "years", "integer", 18, 100),
    ),
    sensitivity_sets={
        "primary (5 features)": ["pregnancies", "glucose", "blood_pressure", "bmi", "age"],
        "primary + pedigree": ["pregnancies", "glucose", "blood_pressure", "bmi", "age", "diabetes_pedigree"],
        "all 8 original features": ["pregnancies", "glucose", "blood_pressure", "skin_thickness", "insulin", "bmi",
                                    "diabetes_pedigree", "age"],
    },
)

HEART = Condition(
    key="heart_disease",
    title="Heart disease",
    dataset="UCI Heart Disease, Cleveland subset (processed.cleveland.data)",
    raw_file="processed.cleveland.data",
    outcome_definition="Angiographic heart disease (any vessel narrowing) found at the time of testing, not future heart attack risk.",
    population_note=(
        "Training data covers 303 patients referred for coronary angiography at one clinic (Cleveland). "
        "It is not a general-population sample."
    ),
    features=(
        Feature("age", "Age", "years", "integer", 18, 100),
        Feature("sex", "Sex (1 = male, 0 = female)", "", "binary", 0, 1),
        Feature("cp", "Chest pain type (1 typical angina, 2 atypical, 3 non-anginal, 4 asymptomatic)", "", "categorical", 1, 4,
                categories=(1, 2, 3, 4)),
        Feature("trestbps", "Resting systolic blood pressure", "mmHg", "continuous", 70, 250, editable=True),
        Feature("chol", "Serum cholesterol", "mg/dL", "continuous", 100, 600, editable=True),
        Feature("fbs", "Fasting blood sugar above 120 mg/dL (1 = yes)", "", "binary", 0, 1),
        Feature("restecg", "Resting ECG result (0 normal, 1 ST-T abnormality, 2 LV hypertrophy)", "", "categorical", 0, 2,
                categories=(0, 1, 2)),
        Feature("thalach", "Maximum heart rate achieved in stress test", "bpm", "continuous", 60, 220),
        Feature("exang", "Exercise-induced angina (1 = yes)", "", "binary", 0, 1),
        Feature("oldpeak", "ST depression induced by exercise", "mm", "continuous", 0, 7),
    ),
    sensitivity_sets={
        "primary (10 features)": ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak"],
        "primary + slope": ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope"],
        "all 13 original features": ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak",
                                     "slope", "ca", "thal"],
    },
)

CONDITIONS = {DIABETES.key: DIABETES, HEART.key: HEART}

# ---- Version 2 models, trained on larger data and evaluated with nested cross-validation (see src/advanced.py) ----
HEART_V2 = Condition(
    key="heart_disease",
    title="Heart disease",
    dataset="UCI Heart Disease, all four hospitals (Cleveland, Hungary, Switzerland, VA Long Beach), 920 patients",
    raw_file="uci_heart",
    outcome_definition="Angiographic heart disease (any vessel narrowing) found at the time of testing, not future heart attack risk.",
    population_note=(
        "Training data covers 920 patients referred for coronary angiography at four hospitals in the 1980s (USA, Hungary, "
        "Switzerland). Switzerland and the VA sample are almost all men with a high disease rate. It is not a general-population sample."
    ),
    features=HEART.features,
    sensitivity_sets={},
)

SURVEY = Condition(
    key="diabetes_survey",
    title="Diabetes (lifestyle survey model)",
    dataset="CDC Behavioral Risk Factor Surveillance System (BRFSS) 2015, 253,096 US adult respondents",
    raw_file="brfss",
    outcome_definition="Respondent reports having been told by a doctor that they have diabetes (not prediabetes), at the time of the survey.",
    population_note=(
        "Training data covers US adults who answered a 2015 telephone health survey. All answers are self-reported. It describes who "
        "already reports a diabetes diagnosis, so it cannot find undiagnosed diabetes, and it is not validated outside the US."
    ),
    features=(
        Feature("high_bp", "Told you have high blood pressure (1 = yes)", "", "binary", 0, 1),
        Feature("high_chol", "Told you have high cholesterol (1 = yes)", "", "binary", 0, 1),
        Feature("bmi", "Body mass index", "kg/m2", "continuous", 12, 70, editable=True),
        Feature("smoker", "Smoked at least 100 cigarettes in your life (1 = yes)", "", "binary", 0, 1, editable=True),
        Feature("stroke", "Ever told you had a stroke (1 = yes)", "", "binary", 0, 1),
        Feature("heart_disease_or_attack", "Ever told you had coronary heart disease or a heart attack (1 = yes)", "", "binary", 0, 1),
        Feature("physical_activity", "Any physical activity in the past 30 days outside work (1 = yes)", "", "binary", 0, 1, editable=True),
        Feature("fruit_daily", "Eat fruit at least once a day (1 = yes)", "", "binary", 0, 1, editable=True),
        Feature("veg_daily", "Eat vegetables at least once a day (1 = yes)", "", "binary", 0, 1, editable=True),
        Feature("heavy_alcohol", "Heavy drinker (men over 14, women over 7 drinks a week) (1 = yes)", "", "binary", 0, 1, editable=True),
        Feature("general_health", "General health (1 excellent, 2 very good, 3 good, 4 fair, 5 poor)", "", "integer", 1, 5),
        Feature("mental_health_days", "Days of poor mental health in the past 30", "days", "integer", 0, 30),
        Feature("physical_health_days", "Days of poor physical health in the past 30", "days", "integer", 0, 30),
        Feature("difficulty_walking", "Serious difficulty walking or climbing stairs (1 = yes)", "", "binary", 0, 1),
        Feature("sex", "Sex (1 = male, 0 = female)", "", "binary", 0, 1),
        Feature("age_band", "Age group (1 = 18-24, 2 = 25-29, ... 12 = 75-79, 13 = 80 or older)", "", "integer", 1, 13),
    ),
    sensitivity_sets={},
)

BRFSS_RENAME = {"HighBP": "high_bp", "HighChol": "high_chol", "BMI": "bmi", "Smoker": "smoker", "Stroke": "stroke",
                "HeartDiseaseorAttack": "heart_disease_or_attack", "PhysActivity": "physical_activity", "Fruits": "fruit_daily",
                "Veggies": "veg_daily", "HvyAlcoholConsump": "heavy_alcohol", "GenHlth": "general_health",
                "MentHlth": "mental_health_days", "PhysHlth": "physical_health_days", "DiffWalk": "difficulty_walking",
                "Sex": "sex", "Age": "age_band"}
