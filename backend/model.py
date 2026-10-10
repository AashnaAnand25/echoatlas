"""Load an explicitly trained EchoAtlas model when one is provided.

The included small U-Net baseline is separate from the MaskFormer described in
the research paper. This module deliberately does not initialize random
weights or substitute the old brain-tumor CNN.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

CLASS_NAMES = ["normal", "benign", "malignant"]


def load_model(model_path: str | Path, device: Any):
    """Load a project-supplied baseline checkpoint.

    A checkpoint is produced by ``scripts/train_busi_baseline.py``. Keeping
    loading conditional lets API status remain honest until training completes.
    """
    checkpoint_path = Path(model_path)
    if not checkpoint_path.is_file():
        return None, CLASS_NAMES, f"Checkpoint not found: {checkpoint_path.name}"

    try:
        from backend.baseline import load_inference_model
    except ImportError:
        return None, CLASS_NAMES, (
            "BUSI baseline loader is not present. Add the project model code "
            "and a compatible checkpoint before enabling inference."
        )

    try:
        model = load_inference_model(str(checkpoint_path), device)
    except Exception as exc:  # Preserve API availability while surfacing the exact setup issue.
        return None, CLASS_NAMES, f"Could not load BUSI baseline checkpoint: {exc}"
    return model, CLASS_NAMES, None
