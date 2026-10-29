# Model card: Diabetes estimate, version 1.0.0

> **Experimental model estimate, not a diagnosis.** Educational and research demonstration of how a simple model's estimate changes with its inputs. NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use.

## What the number means
The model outputs a calibrated probability for this dataset label: *Diabetes diagnosis recorded in the dataset (WHO criteria), not future onset.*
It is **not** a personal prediction of future disease and it has **not** been clinically or externally validated.

## Data
- Dataset: Pima Indians Diabetes Database (NIDDK)
- File: `pima.csv`, SHA-256 `6bfe5d0f379d17a0...`
- Rows: 768, positives: 268 (34.9%)
- Population: Training data covers 768 women aged 21-81 of Pima Indian heritage. Estimates for men, other ethnic groups or ages outside 21-81 are outside what the data represents.
- Split: stratified 614 train / 154 test, seed 42. Test rows were used only for the final report below.

## Inputs (primary feature set)
- **pregnancies**: Pregnancies (count)
- **glucose**: 2-hour plasma glucose (oral glucose tolerance test) (mg/dL), editable in What-If
- **blood_pressure**: Diastolic blood pressure (mmHg), editable in What-If
- **bmi**: Body mass index (kg/m2), editable in What-If
- **age**: Age (years)

## Method
- Preprocessing (imputation, scaling, one-hot encoding) is inside the pipeline and fit on training rows only.
- Logistic Regression and Random Forest were tuned by 5-fold cross-validation on training rows (ROC-AUC).
- Selection rule: Random Forest only if its CV ROC-AUC beats Logistic Regression by more than 0.01; otherwise the simpler Logistic Regression is used. **Selected: logistic regression.**
- Probabilities are sigmoid-calibrated on training data.
- Operating threshold 0.249 was chosen on out-of-fold training predictions (Youden J).

## Held-out test results (threshold 0.5)
| Model | CV ROC-AUC (train) | Test ROC-AUC | Brier | Sensitivity | Specificity | Accuracy |
|---|---|---|---|---|---|---|
| Logistic Regression (primary) | 0.841 +/- 0.017 | 0.803 | 0.180 | 53.7% | 80.0% | 70.8% |
| Random Forest | 0.835 +/- 0.026 | 0.812 | 0.169 | 57.4% | 84.0% | 74.7% |

Primary model confusion matrix at 0.5: TN 80, FP 20, **FN 25**, TP 29.
At the operating threshold 0.249: TN 65, FP 35, **FN 10**, TP 44
(sensitivity 81.5%, specificity 65.0%).
False negatives (missed positives) matter most for a health screening-style use, so check them, not accuracy alone.

Calibration on the test set (5 quantile bins): mean absolute gap between predicted probability and observed frequency
0.099, largest gap 0.235. With only 154 test rows
each bin holds about 30 people, so treat this as a rough check, not proof of good calibration.

Most influential inputs by permutation importance on the test set (AUC drop): glucose (0.166), bmi (0.036), pregnancies (0.025). This describes model behaviour, not medical causation.

## Feature-set sensitivity (training cross-validation ROC-AUC, informational)
| Feature set | Logistic Regression | Random Forest |
|---|---|---|
| primary (5 features) | 0.841 | 0.833 |
| primary + pedigree | 0.847 | 0.837 |
| all 8 original features | 0.843 | 0.838 |

## Trust Meter (test set)
Mean width of the bootstrap range: 0.092 probability.
Mean Logistic-vs-Forest disagreement: 6.2 percentage points;
20.1% of test rows differ by more than 10 points.
The range reflects model-fitting variability on a small dataset, not a confidence interval for a person's true risk.

## Limitations
- Small public dataset, one population, one time period. Public benchmark data is not clinical validation.
- The test set is small, so every metric has wide uncertainty; do not over-read differences of a few points.
- What-If changes show how the model's estimate moves. They do not show that changing an input changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions above).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.

## Reproducibility
Trained 2026-10-29T07:36:51+00:00 with scikit-learn 1.9.1, numpy 2.5.3,
pandas 3.0.5, shap 0.54.1, Python 3.13.18.
Re-run: `python -m src.train --condition diabetes`.
