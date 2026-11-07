# Nested cross-validation: brfss_2015

Outer: 5 folds. Inner: 3-fold grid search on a 25,000-row sample of each training part. Rows: 253096.

| Algorithm | ROC-AUC (mean +/- sd) | Brier | Calibration error (ECE) | AUC gain vs logistic |
|---|---|---|---|---|
| logistic regression | 0.821 +/- 0.002 | 0.099 | 0.013 | +0.000 (better in 0/5 folds) |
| random forest | 0.826 +/- 0.003 | 0.099 | 0.031 | +0.004 (better in 5/5 folds) |
| hist gradient boosting | 0.828 +/- 0.002 | 0.097 | 0.004 | +0.006 (better in 5/5 folds) |
| neural network | 0.827 +/- 0.002 | 0.099 | 0.034 | +0.005 (better in 5/5 folds) |

**Chosen:** logistic regression. hist_gradient_boosting scored highest (AUC 0.828) but only 0.006 above logistic_regression, within the 0.01 simplicity margin, so the simpler model is kept.


## Subgroup ROC-AUC (pooled out-of-fold predictions)

- women: AUC 0.833 (n=141676, rate 0.13)
- men: AUC 0.807 (n=111420, rate 0.15)
- age 18-44: AUC 0.844 (n=54198, rate 0.04)
- age 45-64: AUC 0.819 (n=142078, rate 0.15)
- age 65+: AUC 0.732 (n=56820, rate 0.21)
- BMI under 25: AUC 0.823 (n=72080, rate 0.06)
- BMI 25-29.9: AUC 0.797 (n=93749, rate 0.11)
- BMI 30+: AUC 0.774 (n=87267, rate 0.23)
