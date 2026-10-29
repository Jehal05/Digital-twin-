"""CLI: python -m src.train --condition diabetes|heart_disease|all [--fast]"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import config as C
from .data import LOADERS
from .pipeline import train_condition


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Train HealthTwin models")
    ap.add_argument("--condition", default="all", choices=["all", *C.CONDITIONS])
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--fast", action="store_true", help="smaller grids and forests (for tests / smoke runs only)")
    ap.add_argument("--raw-dir", type=Path, default=C.RAW_DIR)
    ap.add_argument("--out", type=Path, default=C.ARTIFACT_DIR)
    args = ap.parse_args(argv)

    keys = list(C.CONDITIONS) if args.condition == "all" else [args.condition]
    trained, skipped = [], []
    for key in keys:
        cond = C.CONDITIONS[key]
        path = args.raw_dir / cond.raw_file
        if not path.exists():
            skipped.append((key, path))
            continue
        X, y, info = LOADERS[key](path)
        res = train_condition(cond, X, y, info, args.out, version=args.version, fast=args.fast)
        m = res["metrics"]["models"][res["metrics"]["primary_algorithm"]]["test"]
        print(f"[{key}] primary={res['metrics']['primary_algorithm']} test ROC-AUC={m['roc_auc']} -> {res['out_dir']}")
        trained.append(key)
    for key, path in skipped:
        print(f"[{key}] SKIPPED: {path} not found. See ml/README.md for where to get it.", file=sys.stderr)
    return 0 if trained or not skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
