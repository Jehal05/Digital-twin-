# Model card: Diabetes (lifestyle survey model), version 1.0.0

> **Experimental model estimate, not a diagnosis.** Educational and research demonstration of how a simple model's estimate changes with its inputs. NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use.

## What the number means
The model outputs a calibrated probability for this dataset label: *Respondent reports having been told by a doctor that they have diabetes (not prediabetes), at the time of the survey.*
It is **not** a personal prediction of future disease and it has **not** been clinically validated.

## Data
- Dataset: CDC Behavioral Risk Factor Surveillance System (BRFSS) 2015, 253,096 US adult respondents
- Rows used: 253096, with the outcome: 35270 (13.9%)
- Population: Training data covers US adults who answered a 2015 telephone health survey. All answers are self-reported. It describes who already reports a diabetes diagnosis, so it cannot find undiagnosed diabetes, and it is not validated outside the US.

## Inputs
- **high_bp**: Told you have high blood pressure (1 = yes)
- **high_chol**: Told you have high cholesterol (1 = yes)
- **bmi**: Body mass index (kg/m2), editable in What-If
- **smoker**: Smoked at least 100 cigarettes in your life (1 = yes), editable in What-If
- **stroke**: Ever told you had a stroke (1 = yes)
- **heart_disease_or_attack**: Ever told you had coronary heart disease or a heart attack (1 = yes)
- **physical_activity**: Any physical activity in the past 30 days outside work (1 = yes), editable in What-If
- **fruit_daily**: Eat fruit at least once a day (1 = yes), editable in What-If
- **veg_daily**: Eat vegetables at least once a day (1 = yes), editable in What-If
- **heavy_alcohol**: Heavy drinker (men over 14, women over 7 drinks a week) (1 = yes), editable in What-If
- **general_health**: General health (1 excellent, 2 very good, 3 good, 4 fair, 5 poor)
- **mental_health_days**: Days of poor mental health in the past 30 (days)
- **physical_health_days**: Days of poor physical health in the past 30 (days)
- **difficulty_walking**: Serious difficulty walking or climbing stairs (1 = yes)
- **sex**: Sex (1 = male, 0 = female)
- **age_band**: Age group (1 = 18-24, 2 = 25-29, ... 12 = 75-79, 13 = 80 or older)

## How it was evaluated (nested cross-validation)
Outer: 5 folds. Inner: 3-fold grid search on a 25,000-row sample of each training part. Hyper-parameters were chosen only inside
each training part; every row was then predicted by models that never saw it. Probabilities are sigmoid-calibrated.
Compared: logistic regression, random forest, histogram gradient boosting and a small neural network.

| Algorithm | ROC-AUC (mean +/- sd over folds) | Brier | Calibration error | AUC gain vs logistic regression |
|---|---|---|---|---|
| logistic regression (primary) | 0.821 +/- 0.002 | 0.099 | 0.013 | +0.000 (better in 0/5) |
| random forest | 0.826 +/- 0.003 | 0.099 | 0.031 | +0.004 (better in 5/5) |
| hist gradient boosting | 0.828 +/- 0.002 | 0.097 | 0.004 | +0.006 (better in 5/5) |
| neural network | 0.827 +/- 0.002 | 0.099 | 0.034 | +0.005 (better in 5/5) |

**Selected: logistic regression.** Nested cross-validation across 4 algorithms; the simplest model within 0.01 ROC-AUC of the best is kept. hist_gradient_boosting scored highest (AUC 0.828) but only 0.006 above logistic_regression, within the 0.01 simplicity margin, so the simpler model is kept.

A more complex model is only worth deploying if it wins clearly. If the gains above are within one fold-to-fold standard
deviation, they are noise, not evidence.

## Mistakes at the operating threshold 0.127
Out of 253096 out-of-fold predictions: TN 151903, FP 65923, **FN 7234**, TP 28036
(sensitivity 79.5%, specificity 69.7%).
The threshold was chosen on these same predictions, so these two rates are slightly optimistic.

Calibration (5 quantile bins of out-of-fold predictions): mean absolute gap 0.009, largest 0.018.

Most influential inputs (permutation importance, AUC drop): general_health (0.059), bmi (0.035), age_band (0.031), high_bp (0.020). This describes model behaviour, not medical causation.

## Performance by subgroup (ROC-AUC, out-of-fold)
- women: ROC-AUC 0.833 (n=141676, outcome rate 13.0%)
- men: ROC-AUC 0.807 (n=111420, outcome rate 15.2%)
- age 18-44: ROC-AUC 0.844 (n=54198, outcome rate 4.0%)
- age 45-64: ROC-AUC 0.819 (n=142078, outcome rate 15.0%)
- age 65+: ROC-AUC 0.732 (n=56820, outcome rate 20.7%)
- BMI under 25: ROC-AUC 0.823 (n=72080, outcome rate 5.7%)
- BMI 25-29.9: ROC-AUC 0.797 (n=93749, outcome rate 11.4%)
- BMI 30+: ROC-AUC 0.774 (n=87267, outcome rate 23.5%)
Differences between subgroups mean the estimate is more reliable for some people than others.

## Trust Meter
Mean bootstrap range width 0.008; mean logistic-vs-forest disagreement
3.6 percentage points (8.2% of rows over 10 points).

## Limitations
- Public benchmark data is not clinical validation, and the data are old or from one country.
- What-If changes show how the model's estimate moves, not that changing a habit changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.
- Self-reported survey answers; the outcome is an existing diagnosis, so undiagnosed diabetes is counted as 'no diabetes'. Income, education and insurance were deliberately left out so the estimate cannot depend on them.

## Reproducibility
Trained 2026-11-07T09:52:20+00:00 with scikit-learn 1.9.1, numpy 2.5.3,
pandas 3.0.5, Python 3.13.18.
Re-run: `python -m src.experiments survey` then `python -m src.finalize survey --version 1.0.0`.
