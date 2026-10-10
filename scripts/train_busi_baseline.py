#!/usr/bin/env python3
"""Train/evaluate a small BUSI U-Net baseline (not the paper's MaskFormer)."""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (accuracy_score, average_precision_score,
                             balanced_accuracy_score, f1_score)
from torch.nn import functional as F
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.baseline import BUSIMultiTaskUNet
from backend.busi_dataset import BUSIDataset, CLASS_TO_INDEX

CLASS_NAMES = [name for name, _ in sorted(CLASS_TO_INDEX.items(), key=lambda item: item[1])]


def select_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def evaluate(model, loader, device) -> dict:
    model.eval()
    targets, probabilities = [], []
    dice_scores, iou_scores = [], []
    with torch.inference_mode():
        for batch in loader:
            images = batch["image"].to(device)
            masks = batch["mask"].to(device)
            labels = batch["label"].to(device)
            mask_logits, class_logits = model(images)
            probs = torch.softmax(class_logits, dim=1)
            predictions = torch.sigmoid(mask_logits) >= 0.5
            truth = masks >= 0.5
            for pred, target in zip(predictions, truth):
                intersection = (pred & target).sum().item()
                pred_count, target_count = pred.sum().item(), target.sum().item()
                denom = pred_count + target_count
                union = (pred | target).sum().item()
                dice_scores.append(1.0 if denom == 0 else 2 * intersection / denom)
                iou_scores.append(1.0 if union == 0 else intersection / union)
            targets.extend(labels.cpu().tolist())
            probabilities.extend(probs.cpu().numpy().tolist())

    probs_array = np.asarray(probabilities)
    target_array = np.asarray(targets)
    predictions = probs_array.argmax(axis=1)
    one_hot = np.eye(len(CLASS_NAMES))[target_array]
    try:
        mean_ap = float(average_precision_score(one_hot, probs_array, average="macro"))
    except ValueError:
        mean_ap = None
    return {
        "image_count": len(targets),
        "classification_accuracy": float(accuracy_score(target_array, predictions)),
        "classification_balanced_accuracy": float(balanced_accuracy_score(target_array, predictions)),
        "classification_macro_f1": float(f1_score(target_array, predictions, average="macro", zero_division=0)),
        "classification_macro_mAP": mean_ap,
        "segmentation_mean_dice": float(np.mean(dice_scores)),
        "segmentation_mean_iou": float(np.mean(iou_scores)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("data/busi_manifest.csv"))
    parser.add_argument("--data-root", type=Path, default=Path("data/Dataset_BUSI_with_GT"))
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=0.0005)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto", help="auto, cuda, mps, or cpu")
    parser.add_argument("--checkpoint", type=Path, default=Path("models/EchoAtlas_baseline.pt"))
    parser.add_argument("--report", type=Path, default=Path("data/busi_baseline_metrics.json"))
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = select_device(args.device)
    train_set = BUSIDataset(args.manifest, args.data_root, "train", args.image_size)
    val_set = BUSIDataset(args.manifest, args.data_root, "validation", args.image_size)
    test_set = BUSIDataset(args.manifest, args.data_root, "test", args.image_size)
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_set, batch_size=args.batch_size, shuffle=False, num_workers=0)

    model = BUSIMultiTaskUNet(num_classes=len(CLASS_NAMES)).to(device)
    class_counts = Counter(row["label"] for row in train_set.rows)
    class_weights = torch.tensor(
        [len(train_set) / (len(CLASS_NAMES) * class_counts[name]) for name in CLASS_NAMES],
        dtype=torch.float32, device=device,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_f1 = -1.0
    args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for batch in train_loader:
            images, masks = batch["image"].to(device), batch["mask"].to(device)
            labels = batch["label"].to(device)
            # Horizontal flips are applied to training examples only.
            flip = torch.rand(images.shape[0], device=device) < 0.5
            images[flip] = images[flip].flip(-1)
            masks[flip] = masks[flip].flip(-1)

            optimizer.zero_grad(set_to_none=True)
            mask_logits, class_logits = model(images)
            bce = F.binary_cross_entropy_with_logits(mask_logits, masks)
            mask_prob = torch.sigmoid(mask_logits)
            intersection = (mask_prob * masks).sum(dim=(1, 2, 3))
            dice_loss = 1.0 - ((2 * intersection + 1) /
                               (mask_prob.sum(dim=(1, 2, 3)) + masks.sum(dim=(1, 2, 3)) + 1)).mean()
            class_loss = F.cross_entropy(class_logits, labels, weight=class_weights)
            loss = bce + dice_loss + class_loss
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        validation = evaluate(model, val_loader, device)
        average_loss = total_loss / max(len(train_loader), 1)
        print(f"epoch={epoch}/{args.epochs} loss={average_loss:.4f} val_macro_f1={validation['classification_macro_f1']:.4f} val_dice={validation['segmentation_mean_dice']:.4f}", flush=True)
        if validation["classification_macro_f1"] > best_f1:
            best_f1 = validation["classification_macro_f1"]
            torch.save({
                "model_state_dict": model.state_dict(),
                "classes": CLASS_NAMES,
                "image_size": args.image_size,
                "architecture": "BUSIMultiTaskUNet",
                "seed": args.seed,
                "epoch": epoch,
            }, args.checkpoint)

    best_checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(best_checkpoint["model_state_dict"])
    report = {
        "dataset": "BUSI",
        "model": "small multi-task U-Net trained from scratch; not MaskFormer",
        "device": str(device),
        "seed": args.seed,
        "selected_epoch": best_checkpoint["epoch"],
        "image_size": args.image_size,
        "split": "duplicate-grouped stratified image-level split; not patient-level",
        "validation": evaluate(model, val_loader, device),
        "test": evaluate(model, test_loader, device),
        "caveat": "Exploratory hackathon baseline on BUSI; not clinical evidence. Review audit for duplicate candidates and cross-label groups.",
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Checkpoint: {args.checkpoint}; metrics: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
