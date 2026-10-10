#!/usr/bin/env python3
"""Audit BUSI images and create duplicate-grouped train/validation/test splits.

Expected input is the original BUSI folder tree (normal/, benign/, malignant/)
with image files and optional ``_mask`` / ``_mask_N`` annotation files together.
Mask images are annotations and are never treated as model inputs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
CLASSES = ("normal", "benign", "malignant")
MASK_SUFFIX = re.compile(r"_mask(?:[_ -]?\d+)?$", re.IGNORECASE)


def label_for(path: Path, root: Path) -> str:
    """Get the class from a class directory, falling back to the file prefix."""
    relative_parts = path.relative_to(root).parts[:-1]
    for part in reversed(relative_parts):
        value = part.casefold().strip()
        if value in CLASSES:
            return value

    match = re.match(r"^(normal|benign|malignant)(?:\b|\s|_|-)", path.stem, re.I)
    if match:
        return match.group(1).casefold()
    raise ValueError(f"Cannot infer BUSI label for {path}; expected a class folder or filename prefix")


def is_mask(path: Path) -> bool:
    return MASK_SUFFIX.search(path.stem) is not None


def image_key(path: Path, root: Path) -> tuple[str, str]:
    stem = MASK_SUFFIX.sub("", path.stem).casefold().strip()
    parent = path.parent.relative_to(root).as_posix().casefold()
    return parent, stem


class UnionFind:
    def __init__(self, count: int) -> None:
        self.parent = list(range(count))
        self.rank = [0] * count

    def find(self, item: int) -> int:
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: int, right: int) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


def duplicate_groups(images: list[Path], distance: int) -> tuple[list[str], int]:
    """Group exact and near-duplicate images using perceptual hashes."""
    try:
        import imagehash
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Install Pillow and ImageHash to build the BUSI audit manifest") from exc

    hashes = []
    exact_hashes = []
    for path in images:
        with Image.open(path) as image:
            hashes.append(imagehash.phash(image.convert("L"), hash_size=8))
        exact_hashes.append(hashlib.sha256(path.read_bytes()).hexdigest())

    sets = UnionFind(len(images))
    exact_seen: dict[str, int] = {}
    for index, digest in enumerate(exact_hashes):
        if digest in exact_seen:
            sets.union(index, exact_seen[digest])
        else:
            exact_seen[digest] = index

    for left in range(len(images)):
        for right in range(left + 1, len(images)):
            if hashes[left] - hashes[right] <= distance:
                sets.union(left, right)

    roots = [sets.find(index) for index in range(len(images))]
    root_names: dict[int, str] = {}
    names = []
    for root_index in roots:
        root_names.setdefault(root_index, f"dup-{len(root_names) + 1:04d}")
        names.append(root_names[root_index])
    group_sizes = Counter(names)
    return names, sum(size > 1 for size in group_sizes.values())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="BUSI dataset root containing class folders")
    parser.add_argument("--output", type=Path, default=Path("data/busi_manifest.csv"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--phash-distance", type=int, default=4, help="Maximum pHash Hamming distance to group")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"Dataset root does not exist or is not a directory: {root}")

    files = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() in IMAGE_EXTENSIONS
    )
    masks = [path for path in files if is_mask(path)]
    images = [path for path in files if not is_mask(path)]
    if not images:
        parser.error(f"No BUSI image files found under {root}")

    mask_index: dict[tuple[str, str], list[Path]] = defaultdict(list)
    for mask in masks:
        mask_index[image_key(mask, root)].append(mask)

    records = []
    missing_masks = []
    for image in images:
        label = label_for(image, root)
        image_masks = sorted(mask_index.get(image_key(image, root), []))
        if label != "normal" and not image_masks:
            missing_masks.append(image)
        records.append({"path": image, "label": label, "masks": image_masks})

    try:
        group_ids, duplicate_group_count = duplicate_groups(images, args.phash_distance)
        import numpy as np
        from sklearn.model_selection import StratifiedGroupKFold
    except (ImportError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    labels = np.asarray([record["label"] for record in records])
    groups = np.asarray(group_ids)
    splitter = StratifiedGroupKFold(n_splits=10, shuffle=True, random_state=args.seed)
    folds = list(splitter.split(np.zeros(len(records)), labels, groups))
    test_indices = set(folds[0][1].tolist())
    validation_indices = set(folds[1][1].tolist())
    train_indices = set(range(len(records))) - test_indices - validation_indices
    split_by_index = {}
    for index in train_indices:
        split_by_index[index] = "train"
    for index in validation_indices:
        split_by_index[index] = "validation"
    for index in test_indices:
        split_by_index[index] = "test"

    split_groups: dict[str, set[str]] = defaultdict(set)
    grouped_labels: dict[str, set[str]] = defaultdict(set)
    for index, group in enumerate(group_ids):
        split_groups[split_by_index[index]].add(group)
        grouped_labels[group].add(records[index]["label"])
    if (split_groups["train"] & split_groups["validation"]
            or split_groups["train"] & split_groups["test"]
            or split_groups["validation"] & split_groups["test"]):
        raise RuntimeError("Duplicate group crossed a data split")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_path = args.output.expanduser().resolve()
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=("image", "label", "mask_paths", "group_id", "split"))
        writer.writeheader()
        for index, record in enumerate(records):
            writer.writerow({
                "image": record["path"].relative_to(root).as_posix(),
                "label": record["label"],
                "mask_paths": ";".join(mask.relative_to(root).as_posix() for mask in record["masks"]),
                "group_id": group_ids[index],
                "split": split_by_index[index],
            })

    counts = Counter(record["label"] for record in records)
    conflicting_groups = [
        {
            "group_id": group,
            "labels": sorted(grouped_labels[group]),
            "images": [
                record["path"].relative_to(root).as_posix()
                for index, record in enumerate(records)
                if group_ids[index] == group
            ],
            "split": next(split_by_index[index] for index, value in enumerate(group_ids) if value == group),
        }
        for group in sorted(grouped_labels)
        if len(grouped_labels[group]) > 1
    ]
    split_counts = {
        split: dict(Counter(records[index]["label"] for index in indices))
        for split, indices in (("train", train_indices), ("validation", validation_indices), ("test", test_indices))
    }
    audit = {
        "dataset_root": str(root),
        "image_count": len(images),
        "mask_file_count": len(masks),
        "class_counts": dict(counts),
        "split_class_counts": split_counts,
        "candidate_duplicate_group_count_with_multiple_images": duplicate_group_count,
        "candidate_duplicate_image_count": sum(
            size for size in Counter(group_ids).values() if size > 1
        ),
        "cross_label_candidate_groups": conflicting_groups,
        "phash_hamming_distance": args.phash_distance,
        "groups_crossing_splits": False,
        "missing_masks_for_lesion_images": [path.relative_to(root).as_posix() for path in missing_masks],
        "note": "BUSI does not provide reliable patient IDs. Duplicate grouping reduces, but cannot rule out, patient-level leakage.",
    }
    audit_path = output_path.with_suffix(".audit.json")
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(images)} original-image records to {output_path}")
    print(f"Image counts by class: {dict(counts)}")
    print(f"Masks: {len(masks)}; duplicate groups: {duplicate_group_count}; missing lesion masks: {len(missing_masks)}")
    if conflicting_groups:
        print(f"WARNING: {len(conflicting_groups)} candidate duplicate groups contain conflicting class labels; review the audit JSON.")
    print(f"Wrote audit summary to {audit_path}")
    if missing_masks:
        print("WARNING: some benign/malignant images have no paired masks; inspect the audit before training.")
    print("NOTE: duplicate-aware splits are not patient-level splits because BUSI has no reliable patient IDs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
