"""CPU inference for the exported EchoAtlas U-Net ONNX model.

This adapter keeps hosted inference independent of PyTorch's much larger
runtime package. The .onnx file is exported from the trained local checkpoint;
it contains the same model weights and does not include training images.
"""

from __future__ import annotations

import base64
import io
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

CLASS_NAMES = ["normal", "benign", "malignant"]
IMAGE_SIZE = 256


def load_onnx_model(model_path: str | Path):
    path = Path(model_path)
    if not path.is_file():
        return None, CLASS_NAMES, f"ONNX checkpoint not found: {path.name}"
    try:
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        if not session.get_inputs() or session.get_inputs()[0].name != "image":
            raise ValueError("Unexpected ONNX input signature")
        output_names = {item.name for item in session.get_outputs()}
        if not {"mask_logits", "class_logits"}.issubset(output_names):
            raise ValueError("ONNX model is missing expected output tensors")
        return session, CLASS_NAMES, None
    except Exception as exc:
        return None, CLASS_NAMES, f"Could not load EchoAtlas ONNX model: {exc}"


def predict_image_onnx(image_path: str | Path, session, classes: list[str]) -> dict:
    """Run the exported U-Net on an image and return its class scores + mask."""
    started = time.perf_counter()
    with Image.open(image_path) as source:
        original_size = source.size
        grayscale = source.convert("L").resize(
            (IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR
        )
        array = np.asarray(grayscale, dtype=np.float32) / 255.0

    image = np.repeat(array[None, None, :, :], 3, axis=1)
    mask_logits, class_logits = session.run(
        ["mask_logits", "class_logits"], {"image": image}
    )
    logits = class_logits[0].astype(np.float64)
    logits -= logits.max()
    probabilities = np.exp(logits)
    probabilities /= probabilities.sum()

    # sigmoid(x) >= .5 is exactly equivalent to x >= 0.
    binary_mask = (mask_logits[0, 0] >= 0).astype(np.uint8) * 255
    mask_image = Image.fromarray(binary_mask).resize(
        original_size, Image.Resampling.NEAREST
    )
    buffer = io.BytesIO()
    mask_image.save(buffer, format="PNG")
    return {
        "mode": "trained-baseline",
        "model_name": "EchoAtlas BUSI multi-task U-Net (ONNX Runtime CPU)",
        "prediction": classes[int(np.argmax(probabilities))],
        "probabilities": dict(zip(classes, probabilities.tolist())),
        "segmentation_mask": "data:image/png;base64,"
        + base64.b64encode(buffer.getvalue()).decode("ascii"),
        "inference_time_ms": round((time.perf_counter() - started) * 1000, 2),
    }
