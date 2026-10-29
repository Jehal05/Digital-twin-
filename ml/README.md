# HealthTwin ML (Phase 2)

Trains, evaluates and serves the two experimental risk models. Output is a **model-estimated probability of the dataset's label, not a diagnosis**.

## Run
```bash
cd ml
pip install -r requirements.txt
python -m src.train --condition diabetes        # or heart_disease, or all
python -m pytest -q
```
Artifacts go to `artifacts/<condition>/<version>/` (model, schema, metrics, cohort stats, manifest, `MODEL_CARD.md`); `artifacts/<condition>/ACTIVE` names the live version.

## Data (put raw files in `data/raw/`)
| Condition | File | Status |
|---|---|---|
| diabetes | `pima.csv` (768 rows, no header, 9 columns) | Present. Mirror of the NIDDK file; verify SHA-256 in `manifest.json`. |
| heart_disease | `processed.cleveland.data` (303 rows, 14 columns, `?` = missing) | **Needed.** Download the ORIGINAL file from the UCI repository (Heart Disease dataset, `processed.cleveland.data`). Do not use Kaggle `heart.csv`: it recodes columns and flips the target; the loader rejects it. |

## Using the model from the backend
```python
from src.inference import HealthTwinModel, InputValidationError
m = HealthTwinModel.load("diabetes")
m.predict({"pregnancies": 2, "glucose": 140, "blood_pressure": 78, "bmi": 31, "age": 38})
m.compare(baseline_inputs, {"bmi": 27})        # What-If: reruns the real model, editable inputs only
```
`predict` returns score, risk band, model version, input snapshot, SHAP drivers, Trust Meter (LR/RF agreement, bootstrap range, out-of-range inputs) and limitations. Missing or out-of-range inputs raise `InputValidationError` with per-field messages; nothing is silently filled.

## Design decisions to review
- **Diabetes uses 5 inputs** (pregnancies, glucose, diastolic BP, BMI, age). Skin thickness and insulin are missing in 30-49% of Pima rows and rarely measured; the pedigree score cannot be self-reported. Feature-set sensitivity (training CV) is in `metrics.json`; differences are within noise.
- **Pima glucose is a 2-hour oral-glucose-tolerance value**, not fasting or random glucose. The UI must say so.
- **Heart uses 10 inputs**; `slope`, `ca`, `thal` are excluded (need imaging or specialist tests).
- **Model choice** is fixed by a rule set before looking at test data: Random Forest only if its CV ROC-AUC beats Logistic Regression by more than 0.01.
- **Editable in What-If:** diabetes = glucose, blood pressure, BMI; heart = resting BP, cholesterol.
- Tests that use synthetic Cleveland-format data exist only to exercise the heart code path. They never write real artifacts or reported metrics.
