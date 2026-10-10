"""Load the trained EchoAtlas MaskFormer adapter when it is provided.

The public starter repo does not include the MaskFormer implementation or
checkpoint described in the research paper. This module deliberately does not
initialize random weights or substitute the old brain-tumor CNN.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

CLASS_NAMES = ["normal", "benign", "malignant"]


def load_model(model_path: str | Path, device: Any):
    """Load a project-supplied MaskFormer adapter and checkpoint.

    The adapter is expected at ``backend.maskformer_adapter`` and must expose
    ``load_inference_model(checkpoint_path, device)``. Keeping that dependency
    optional lets the API and dataset tooling report a clear model-unavailable
    state until the lab checkpoint/code is added.
    """
    checkpoint_path = Path(model_path)
    if not checkpoint_path.is_file():
        return None, CLASS_NAMES, f"Checkpoint not found: {checkpoint_path.name}"

    try:
        from backend.maskformer_adapter import load_inference_model
    except ImportError:
        return None, CLASS_NAMES, (
            "MaskFormer inference adapter is not present. Add the research model code "
            "and a compatible checkpoint before enabling inference."
        )

    try:
        model = load_inference_model(str(checkpoint_path), device)
    except Exception as exc:  # Preserve API availability while surfacing the exact setup issue.
        return None, CLASS_NAMES, f"Could not load MaskFormer checkpoint: {exc}"
    return model, CLASS_NAMES, None
