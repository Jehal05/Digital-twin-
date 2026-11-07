# Model card: Heart disease, version 2.1.0

> **Experimental model estimate, not a diagnosis.** Educational and research demonstration of how a simple model's estimate changes with its inputs. NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use.

## What the number means
The model outputs a calibrated probability for this dataset label: *Angiographic heart disease (any vessel narrowing) found at the time of testing, not future heart attack risk.*
It is **not** a personal prediction of future disease and it has **not** been clinically validated.

## Data
- Dataset: UCI Heart Disease, all four hospitals (Cleveland, Hungary, Switzerland, VA Long Beach), 920 patients
- Rows used: 920, with the outcome: 509 (55.3%)
- Population: Training data covers 920 patients referred for coronary angiography at four hospitals in the 1980s (USA, Hungary, Switzerland). Switzerland and the VA sample are almost all men with a high disease rate. It is not a general-population sample.

## Inputs
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

## How it was evaluated (nested cross-validation)
Outer: 10 folds (5-fold x 2). Inner: 3-fold grid search. Hyper-parameters were chosen only inside
each training part; every row was then predicted by models that never saw it. Probabilities are sigmoid-calibrated.
Compared: logistic regression, random forest, histogram gradient boosting and a small neural network.

| Algorithm | ROC-AUC (mean +/- sd over folds) | Brier | Calibration error | AUC gain vs logistic regression |
|---|---|---|---|---|
| logistic regression (primary) | 0.879 +/- 0.027 | 0.140 | 0.070 | +0.000 (better in 0/10) |
| random forest | 0.876 +/- 0.024 | 0.141 | 0.071 | -0.002 (better in 3/10) |
| hist gradient boosting | 0.874 +/- 0.026 | 0.142 | 0.077 | -0.004 (better in 4/10) |
| neural network | 0.859 +/- 0.032 | 0.154 | 0.084 | -0.020 (better in 0/10) |

**Selected: logistic regression.** Nested cross-validation across 4 algorithms; the simplest model within 0.01 ROC-AUC of the best is kept. logistic_regression has the highest mean AUC and is also the simplest within 0.01 of the best.

A more complex model is only worth deploying if it wins clearly. If the gains above are within one fold-to-fold standard
deviation, they are noise, not evidence.

## Mistakes at the operating threshold 0.546
Out of 1840 out-of-fold predictions: TN 652, FP 170, **FN 199**, TP 819
(sensitivity 80.5%, specificity 79.3%).
The threshold was chosen on these same predictions, so these two rates are slightly optimistic.

Calibration (5 quantile bins of out-of-fold predictions): mean absolute gap 0.026, largest 0.047.

Most influential inputs (permutation importance, AUC drop): cp (0.075), sex (0.031), oldpeak (0.028), exang (0.022). This describes model behaviour, not medical causation.

## Performance by subgroup (ROC-AUC, out-of-fold)
- male: ROC-AUC 0.856 (n=1452, outcome rate 63.2%)
- female: ROC-AUC 0.864 (n=388, outcome rate 25.8%)
Differences between subgroups mean the estimate is more reliable for some people than others.

## External validation: leave one hospital out (ROC-AUC)
Train on three hospitals, test on the fourth.

| Held-out hospital | Patients | Disease rate | logistic regression | random forest | hist gradient boosting | neural network |
|---|---|---|---|---|---|---|
| cleveland | 303 | 45.9% | 0.870 | 0.861 | 0.851 | 0.831 |
| hungarian | 294 | 36.0% | 0.887 | 0.876 | 0.869 | 0.854 |
| switzerland | 123 | 93.5% | 0.734 | 0.766 | 0.791 | 0.646 |
| va | 200 | 74.5% | 0.751 | 0.737 | 0.744 | 0.775 |

Does adding more hospitals help? Logistic regression, tested on a hospital it never saw:

| Test hospital | Trained on Cleveland only (old model) | Trained on the other three hospitals |
|---|---|---|
| hungarian | 0.882 | 0.887 |
| switzerland | 0.741 | 0.734 |
| va | 0.746 | 0.751 |

The model transfers well between Cleveland and Hungary but clearly worse to Switzerland and the VA sample (different patients, different test practices and missing data). Expect a similar drop for anyone unlike these patients.

## Uncertainty (conformal prediction and Venn-Abers range)
**Conformal prediction set.** For a person like the training data, the set of plausible outcomes contains the true outcome at least 90% of the time, separately for people with and without the outcome (guarantee needs exchangeability, and is averaged over people). Measured by calibrating on half of the out-of-fold predictions and testing on the other half (200 repeats): coverage 90.2% (sd 2.0), 74% of people get a single-outcome answer, 26% are 'too close to call'.

**Venn-Abers range.** Mean width 2.8 percentage points (median 2.4); the well-calibrated probability lies inside it. Wide ranges mean the data cannot pin the number down.

**The guarantee breaks under population shift.** Calibrating on three hospitals and testing on the fourth:

| Held-out hospital | Coverage | Outcome present | Outcome absent |
|---|---|---|---|
| cleveland | 90.8% | 85.6% | 95.1% |
| hungarian | 93.2% | 87.7% | 96.3% |
| switzerland | 88.6% | 89.6% | 75.0% |
| va | 86.5% | 98.0% | 52.9% |

## Trust Meter
Mean Venn-Abers range width 0.028; mean logistic-vs-forest disagreement
6.8 percentage points (22.9% of rows over 10 points).

## Limitations
- Public benchmark data is not clinical validation, and the data are old or from one country.
- What-If changes show how the model's estimate moves, not that changing a habit changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.
- Cholesterol recorded as 0 (172 patients) and a few resting blood-pressure zeros were treated as missing and imputed inside each training part.

## Reproducibility
Trained 2026-11-07T12:58:07+00:00 with scikit-learn 1.9.1, numpy 2.5.3,
pandas 3.0.5, Python 3.13.18.
Re-run: `python -m src.experiments heart` then `python -m src.finalize heart --version 2.1.0`.
