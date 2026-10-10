"""PyTorch dataset for the BUSI manifest produced by scripts/prepare_busi.py."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

CLASS_TO_INDEX = {"normal": 0, "benign": 1, "malignant": 2}


class BUSIDataset(Dataset):
    """Load 512px grayscale BUSI scans and union-combined expert masks.

    Grayscale scans are replicated into three channels for compatibility with
    ImageNet/MaskFormer-style encoders. Missing masks (expected for some normal
    cases) are represented by an all-zero target mask.
    """

    def __init__(self, manifest_path: str | Path, dataset_root: str | Path,
                 split: str | None = None, image_size: int = 512) -> None:
        self.manifest_path = Path(manifest_path).expanduser().resolve()
        self.dataset_root = Path(dataset_root).expanduser().resolve()
        self.image_size = image_size
        if split not in (None, "train", "validation", "test"):
            raise ValueError("split must be train, validation, test, or None")

        with self.manifest_path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        self.rows = [row for row in rows if split is None or row["split"] == split]
        if not self.rows:
            raise ValueError(f"No records found for split={split!r} in {self.manifest_path}")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, object]:
        row = self.rows[index]
        image_path = self.dataset_root / row["image"]
        with Image.open(image_path) as image_file:
            image = image_file.convert("L").resize(
                (self.image_size, self.image_size), Image.Resampling.BILINEAR
            )
            image_array = np.array(image, dtype=np.float32, copy=True) / 255.0

        mask_array = np.zeros((self.image_size, self.image_size), dtype=np.uint8)
        mask_paths = [value for value in row.get("mask_paths", "").split(";") if value]
        for relative_mask in mask_paths:
            with Image.open(self.dataset_root / relative_mask) as mask_file:
                mask_image = mask_file.convert("L").resize(
                    (self.image_size, self.image_size), Image.Resampling.NEAREST
                )
                # Logical union preserves overlapping lesion masks; XOR could erase overlap.
                mask_array = np.maximum(mask_array, np.array(mask_image, dtype=np.uint8, copy=True))
        mask_array = (mask_array > 0).astype(np.float32)

        image_tensor = torch.from_numpy(image_array).unsqueeze(0).repeat(3, 1, 1)
        mask_tensor = torch.from_numpy(mask_array).unsqueeze(0)
        return {
            "image": image_tensor,
            "mask": mask_tensor,
            "label": torch.tensor(CLASS_TO_INDEX[row["label"]], dtype=torch.long),
            "image_path": str(image_path),
            "group_id": row["group_id"],
            "split": row["split"],
        }
