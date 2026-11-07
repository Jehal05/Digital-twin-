# Model card: Diabetes, version 2.0.0

> **Experimental model estimate, not a diagnosis.** Educational and research demonstration of how a simple model's estimate changes with its inputs. NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use.

## What the number means
The model outputs a calibrated probability for this dataset label: *Diabetes diagnosis recorded in the dataset (WHO criteria), not future onset.*
It is **not** a personal prediction of future disease and it has **not** been clinically validated.

## Data
- Dataset: Pima Indians Diabetes Database (NIDDK)
- Rows used: 768, with the outcome: 268 (34.9%)
- Population: Training data covers 768 women aged 21-81 of Pima Indian heritage. Estimates for men, other ethnic groups or ages outside 21-81 are outside what the data represents.

## Inputs
- **pregnancies**: Pregnancies (count)
- **glucose**: 2-hour plasma glucose (oral glucose tolerance test) (mg/dL), editable in What-If
- **blood_pressure**: Diastolic blood pressure (mmHg), editable in What-If
- **bmi**: Body mass index (kg/m2), editable in What-If
- **age**: Age (years)

## How it was evaluated (nested cross-validation)
Outer: 10 folds (5-fold x 2). Inner: 3-fold grid search. Hyper-parameters were chosen only inside
each training part; every row was then predicted by models that never saw it. Probabilities are sigmoid-calibrated.
Compared: logistic regression, random forest, histogram gradient boosting and a small neural network.

| Algorithm | ROC-AUC (mean +/- sd over folds) | Brier | Calibration error | AUC gain vs logistic regression |
|---|---|---|---|---|
| logistic regression (primary) | 0.831 +/- 0.029 | 0.160 | 0.078 | +0.000 (better in 0/10) |
| random forest | 0.838 +/- 0.035 | 0.157 | 0.086 | +0.007 (better in 7/10) |
| hist gradient boosting | 0.837 +/- 0.028 | 0.157 | 0.072 | +0.006 (better in 6/10) |
| neural network | 0.804 +/- 0.036 | 0.177 | 0.115 | -0.027 (better in 3/10) |

**Selected: logistic regression.** Nested cross-validation across 4 algorithms; the simplest model within 0.01 ROC-AUC of the best is kept. random_forest scored highest (AUC 0.838) but only 0.007 above logistic_regression, within the 0.01 simplicity margin, so the simpler model is kept.

A more complex model is only worth deploying if it wins clearly. If the gains above are within one fold-to-fold standard
deviation, they are noise, not evidence.

## Mistakes at the operating threshold 0.235
Out of 1536 out-of-fold predictions: TN 636, FP 364, **FN 76**, TP 460
(sensitivity 85.8%, specificity 63.6%).
The threshold was chosen on these same predictions, so these two rates are slightly optimistic.

Calibration (5 quantile bins of out-of-fold predictions): mean absolute gap 0.036, largest 0.086.

Most influential inputs (permutation importance, AUC drop): glucose (0.196), bmi (0.062), pregnancies (0.029), age (0.006). This describes model behaviour, not medical causation.

## Performance by subgroup (ROC-AUC, out-of-fold)
- age under 30: ROC-AUC 0.847 (n=792, outcome rate 21.2%)
- age 30-44: ROC-AUC 0.785 (n=478, outcome rate 49.4%)
- age 45+: ROC-AUC 0.721 (n=266, outcome rate 49.6%)
Differences between subgroups mean the estimate is more reliable for some people than others.

## Uncertainty (conformal prediction and Venn-Abers range)
**Conformal prediction set.** For a person like the training data, the set of plausible outcomes contains the true outcome at least 90% of the time, separately for people with and without the outcome (guarantee needs exchangeability, and is averaged over people). Measured by calibrating on half of the out-of-fold predictions and testing on the other half (200 repeats): coverage 90.3% (sd 2.2), 64% of people get a single-outcome answer, 36% are 'too close to call'.

**Venn-Abers range.** Mean width 2.7 percentage points (median 1.3); the well-calibrated probability lies inside it. Wide ranges mean the data cannot pin the number down.

## Trust Meter
Mean Venn-Abers range width 0.027; mean logistic-vs-forest disagreement
7.3 percentage points (26.1% of rows over 10 points).

## Limitations
- Public benchmark data is not clinical validation, and the data are old or from one country.
- What-If changes show how the model's estimate moves, not that changing a habit changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.
- Glucose, blood pressure, BMI and insulin recorded as 0 were treated as missing and imputed inside each training part.

## Reproducibility
Trained 2026-11-07T12:57:55+00:00 with scikit-learn 1.9.1, numpy 2.5.3,
pandas 3.0.5, Python 3.13.18.
Re-run: `python -m src.experiments pima` then `python -m src.finalize pima --version 2.0.0`.
