# Nested cross-validation: uci_heart_combined

Outer: 10 folds (5-fold x 2). Inner: 3-fold grid search. Rows: 920.

| Algorithm | ROC-AUC (mean +/- sd) | Brier | Calibration error (ECE) | AUC gain vs logistic |
|---|---|---|---|---|
| logistic regression | 0.879 +/- 0.027 | 0.140 | 0.070 | +0.000 (better in 0/10 folds) |
| random forest | 0.876 +/- 0.024 | 0.141 | 0.071 | -0.002 (better in 3/10 folds) |
| hist gradient boosting | 0.874 +/- 0.026 | 0.142 | 0.077 | -0.004 (better in 4/10 folds) |
| neural network | 0.859 +/- 0.032 | 0.154 | 0.084 | -0.020 (better in 0/10 folds) |

**Chosen:** logistic regression. logistic_regression has the highest mean AUC and is also the simplest within 0.01 of the best.

## Leave-one-hospital-out (external validation, ROC-AUC)

| Held-out hospital | n | disease rate | logistic regression | random forest | hist gradient boosting | neural network |
|---|---|---|---|---|---|---|
| cleveland | 303 | 0.46 | 0.870 | 0.861 | 0.851 | 0.831 |
| hungarian | 294 | 0.36 | 0.887 | 0.876 | 0.869 | 0.854 |
| switzerland | 123 | 0.94 | 0.734 | 0.766 | 0.791 | 0.646 |
| va | 200 | 0.74 | 0.751 | 0.737 | 0.744 | 0.775 |

## Does pooling hospitals help? (logistic regression, tested on a hospital it never saw)

| Test hospital | Trained on Cleveland only | Trained on the other three hospitals |
|---|---|---|
| hungarian | 0.882 | 0.887 |
| switzerland | 0.741 | 0.734 |
| va | 0.746 | 0.751 |

## Subgroup ROC-AUC (pooled out-of-fold predictions)

- male: AUC 0.856 (n=1452, rate 0.63)
- female: AUC 0.864 (n=388, rate 0.26)
