# Model card: Heart disease estimate, version 1.0.0

> **Experimental model estimate, not a diagnosis.** Educational and research demonstration of how a simple model's estimate changes with its inputs. NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use.

## What the number means
The model outputs a calibrated probability for this dataset label: *Angiographic heart disease (any vessel narrowing) found at the time of testing, not future heart attack risk.*
It is **not** a personal prediction of future disease and it has **not** been clinically or externally validated.

## Data
- Dataset: UCI Heart Disease, Cleveland subset (processed.cleveland.data)
- File: `processed.cleveland.data`, SHA-256 `e4757dbc7a995f28...`
- Rows: 303, positives: 139 (45.9%)
- Population: Training data covers 303 patients referred for coronary angiography at one clinic (Cleveland). It is not a general-population sample.
- Split: stratified 242 train / 61 test, seed 42. Test rows were used only for the final report below.

## Inputs (primary feature set)
- **age**: Age (years)
- **sex**: Sex (1 = male, 0 = female)
- **cp**: Chest pain type (1 typical angina, 2 atypical, 3 non-anginal, 4 asymptomatic)
- **trestbps**: Resting systolic blood pressure (mmHg), editable in What-If
- **chol**: Serum cholesterol (mg/dL), editable in What-If
- **fbs**: Fasting blood sugar above 120 mg/dL (1 = yes)
- **restecg**: Resting ECG result (0 normal, 1 ST-T abnormality, 2 LV hypertrophy)
- **thalach**: Maximum heart rate achieved in stress test (bpm)
- **exang**: Exercise-induced angina (1 = yes)
- **oldpeak**: ST depression induced by exercise (mm)

## Method
- Preprocessing (imputation, scaling, one-hot encoding) is inside the pipeline and fit on training rows only.
- Logistic Regression and Random Forest were tuned by 5-fold cross-validation on training rows (ROC-AUC).
- Selection rule: Random Forest only if its CV ROC-AUC beats Logistic Regression by more than 0.01; otherwise the simpler Logistic Regression is used. **Selected: logistic regression.**
- Probabilities are sigmoid-calibrated on training data.
- Operating threshold 0.394 was chosen on out-of-fold training predictions (Youden J).

## Held-out test results (threshold 0.5)
| Model | CV ROC-AUC (train) | Test ROC-AUC | Brier | Sensitivity | Specificity | Accuracy |
|---|---|---|---|---|---|---|
| Logistic Regression (primary) | 0.854 +/- 0.043 | 0.954 | 0.104 | 85.7% | 90.9% | 88.5% |
| Random Forest | 0.847 +/- 0.034 | 0.951 | 0.098 | 82.1% | 84.9% | 83.6% |

Primary model confusion matrix at 0.5: TN 30, FP 3, **FN 4**, TP 24.
At the operating threshold 0.394: TN 26, FP 7, **FN 1**, TP 27
(sensitivity 96.4%, specificity 78.8%).
False negatives (missed positives) matter most for a health screening-style use, so check them, not accuracy alone.

Calibration on the test set (5 quantile bins): mean absolute gap between predicted probability and observed frequency
0.098, largest gap 0.167. With only 61 test rows
each bin holds about 12 people, so treat this as a rough check, not proof of good calibration.

Most influential inputs by permutation importance on the test set (AUC drop): cp (0.112), oldpeak (0.073), sex (0.051). This describes model behaviour, not medical causation.

## Feature-set sensitivity (training cross-validation ROC-AUC, informational)
| Feature set | Logistic Regression | Random Forest |
|---|---|---|
| primary (10 features) | 0.854 | 0.837 |
| primary + slope | 0.856 | 0.838 |
| all 13 original features | 0.906 | 0.896 |

## Trust Meter (test set)
Mean width of the bootstrap range: 0.233 probability.
Mean Logistic-vs-Forest disagreement: 6.5 percentage points;
21.3% of test rows differ by more than 10 points.
The range reflects model-fitting variability on a small dataset, not a confidence interval for a person's true risk.

## Limitations
- Small public dataset, one population, one time period. Public benchmark data is not clinical validation.
- The test set is small, so every metric has wide uncertainty; do not over-read differences of a few points.
- What-If changes show how the model's estimate moves. They do not show that changing an input changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions above).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.

## Reproducibility
Trained 2026-10-29T11:44:54+00:00 with scikit-learn 1.9.1, numpy 2.5.3,
pandas 3.0.5, shap 0.54.1, Python 3.13.18.
Re-run: `python -m src.train --condition heart_disease`.
