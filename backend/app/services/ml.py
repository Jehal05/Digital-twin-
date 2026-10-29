"""Loads the trained models from ml/artifacts and mirrors their metadata into the model_versions table."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.tables import ModelVersion

CONDITIONS = ("diabetes", "heart_disease")


class ModelRegistry:
    def __init__(self, ml_dir: Path):
        self.ml_dir = Path(ml_dir)
        self.artifact_dir = self.ml_dir / "artifacts"
        if str(self.ml_dir) not in sys.path:
            sys.path.insert(0, str(self.ml_dir))
        from src.inference import HealthTwinModel, InputValidationError  # noqa: PLC0415 (path must be set first)
        self._cls = HealthTwinModel
        self.InputValidationError = InputValidationError
        self.models: dict[str, object] = {}
        for condition in CONDITIONS:
            try:
                self.models[condition] = HealthTwinModel.load(condition, artifact_dir=self.artifact_dir)
            except FileNotFoundError:
                continue  # model not trained yet; endpoints answer 503 for this condition

    def get(self, condition: str):
        if condition not in CONDITIONS:
            raise ApiError(404, "not_found", "Unknown condition.")
        model = self.models.get(condition)
        if model is None:
            raise ApiError(503, "model_unavailable",
                           f"The {condition.replace('_', ' ')} model has not been trained yet.")
        return model

    def _dir(self, condition: str) -> Path:
        m = self.get(condition)
        return self.artifact_dir / condition / m.version

    def metrics(self, condition: str) -> dict:
        data = json.loads((self._dir(condition) / "metrics.json").read_text())
        data["split"].pop("test_index", None)  # internal bookkeeping, not for clients
        return data

    def model_card(self, condition: str) -> str:
        return (self._dir(condition) / "MODEL_CARD.md").read_text()

    def manifest(self, condition: str) -> dict:
        return json.loads((self._dir(condition) / "manifest.json").read_text())

    def sync_to_db(self, db: Session) -> None:
        """Make sure each loaded model has a model_versions row, and that exactly one version per condition is active."""
        for condition, model in self.models.items():
            row = db.scalar(select(ModelVersion).where(ModelVersion.condition == condition, ModelVersion.version == model.version))
            if row is None:
                d = self._dir(condition)
                manifest = self.manifest(condition)
                row = ModelVersion(
                    condition=condition, version=model.version, algorithm=model.primary,
                    dataset_ref=f"{manifest['dataset']['file']} sha256:{manifest['dataset']['sha256']}",
                    feature_schema=json.loads((d / "feature_schema.json").read_text()),
                    metrics=self.metrics(condition), cohort_stats=json.loads((d / "cohort_stats.json").read_text()),
                    artifact_path=str(d), intended_use=manifest["intended_use"], is_active=True)
                db.add(row)
                db.flush()
            db.execute(update(ModelVersion).where(ModelVersion.condition == condition, ModelVersion.id != row.id).values(is_active=False))
            row.is_active = True
        db.commit()

    def version_row(self, db: Session, condition: str) -> ModelVersion:
        model = self.get(condition)
        return db.scalar(select(ModelVersion).where(ModelVersion.condition == condition, ModelVersion.version == model.version))
