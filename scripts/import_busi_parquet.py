#!/usr/bin/env python3
"""Extract the CC BY 4.0 MedOtter BUSI parquet mirror into BUSI folders.

This preserves the source image IDs and writes one OR-merged annotation mask
per image. It does not clean or relabel the underlying dataset.
"""

from __future__ import annotations

import argparse
import io
import re
from pathlib import Path

import pyarrow.parquet as parquet
from PIL import Image

SOURCE = "https://huggingface.co/datasets/MedOtter/BUSI"
ATTRIBUTION = """Dataset: BUSI (Breast Ultrasound Images), re-hosted by MedOtter.
Original dataset: Al-Dhabyani et al., Dataset of breast ultrasound images,
Data in Brief 28 (2020), 104863. https://doi.org/10.1016/j.dib.2019.104863
Mirror/source card: https://huggingface.co/datasets/MedOtter/BUSI
License stated by mirror: CC BY 4.0. Attribute the original creators and
follow the source card's data-quality caveats. Raw data is excluded from git.
"""


def image_bytes(value: object) -> bytes:
    """Accept Hugging Face Image structs or already-decoded byte values."""
    if isinstance(value, dict):
        raw = value.get("bytes")
        if raw:
            return raw
        source_path = value.get("path")
        if source_path:
            return Path(source_path).read_bytes()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    raise ValueError(f"Unsupported image cell: {type(value).__name__}")


def safe_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9() _-]+", "_", value).strip(" ._")
    if not stem:
        raise ValueError(f"Invalid empty image ID: {value!r}")
    return stem


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parquet", type=Path, required=True, help="Downloaded BUSI parquet file")
    parser.add_argument("--output", type=Path, default=Path("data/Dataset_BUSI_with_GT"))
    args = parser.parse_args()

    source_path = args.parquet.expanduser().resolve()
    output_root = args.output.expanduser().resolve()
    if not source_path.is_file():
        parser.error(f"Parquet file not found: {source_path}")

    rows_written = 0
    reader = parquet.ParquetFile(source_path)
    required_columns = {"image", "mask", "class_label", "image_id"}
    missing = required_columns - set(reader.schema_arrow.names)
    if missing:
        parser.error(f"Parquet is missing required columns: {', '.join(sorted(missing))}")

    for batch in reader.iter_batches(batch_size=16, columns=sorted(required_columns)):
        for row in batch.to_pylist():
            label = str(row["class_label"]).casefold()
            if label not in {"normal", "benign", "malignant"}:
                raise ValueError(f"Unknown BUSI class label: {label!r}")
            stem = safe_stem(str(row["image_id"]))
            class_dir = output_root / label
            class_dir.mkdir(parents=True, exist_ok=True)

            image_file = class_dir / f"{stem}.png"
            mask_file = class_dir / f"{stem}_mask.png"
            with Image.open(io.BytesIO(image_bytes(row["image"]))) as image:
                image.convert("L").save(image_file, format="PNG")
            mask_cell = row.get("mask")
            if mask_cell is not None:
                with Image.open(io.BytesIO(image_bytes(mask_cell))) as mask:
                    mask.convert("L").save(mask_file, format="PNG")
            rows_written += 1

    (output_root / "SOURCE.txt").write_text(ATTRIBUTION + f"\nSource URL: {SOURCE}\n", encoding="utf-8")
    print(f"Extracted {rows_written} cases to {output_root}")
    print("Review SOURCE.txt and the source dataset card before redistributing this data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
