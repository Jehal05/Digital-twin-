# Nested cross-validation: pima

Outer: 10 folds (5-fold x 2). Inner: 3-fold grid search. Rows: 768.

| Algorithm | ROC-AUC (mean +/- sd) | Brier | Calibration error (ECE) | AUC gain vs logistic |
|---|---|---|---|---|
| logistic regression | 0.831 +/- 0.029 | 0.160 | 0.078 | +0.000 (better in 0/10 folds) |
| random forest | 0.838 +/- 0.035 | 0.157 | 0.086 | +0.007 (better in 7/10 folds) |
| hist gradient boosting | 0.837 +/- 0.028 | 0.157 | 0.072 | +0.006 (better in 6/10 folds) |
| neural network | 0.804 +/- 0.036 | 0.177 | 0.115 | -0.027 (better in 3/10 folds) |

**Chosen:** logistic regression. random_forest scored highest (AUC 0.838) but only 0.007 above logistic_regression, within the 0.01 simplicity margin, so the simpler model is kept.


## Subgroup ROC-AUC (pooled out-of-fold predictions)

- age under 30: AUC 0.847 (n=792, rate 0.21)
- age 30-44: AUC 0.785 (n=478, rate 0.49)
- age 45+: AUC 0.721 (n=266, rate 0.50)
