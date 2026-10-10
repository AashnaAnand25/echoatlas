# BUSI baseline: exploratory run

This is a short, from-scratch multi-task U-Net run for the hackathon prototype. It is **not** the MaskFormer model from Anand et al. and does not reproduce that paper's reported 0.943 mAP.

## Run setup

- Dataset mirror: MedOtter BUSI, CC BY 4.0; original dataset credited to Al-Dhabyani et al. (2020), DOI [10.1016/j.dib.2019.104863](https://doi.org/10.1016/j.dib.2019.104863).
- 780 scans: 437 benign, 210 malignant, 133 normal.
- Duplicate-aware stratified image split: 624 train, 78 validation, 78 test. BUSI has no reliable patient identifiers, so this is not patient-level validation.
- Perceptual hash threshold: 4. The audit grouped 277 scans into 124 candidate duplicate groups and flagged 8 cross-label candidate groups. Review `data/busi_manifest.audit.json` before drawing conclusions.
- Model: small U-Net with a segmentation head and a three-class head; initialized from scratch.
- Input size 256 × 256; 20 epochs; seed 42; Apple MPS; best checkpoint selected by validation macro-F1 (epoch 17).

## Held-out test metrics

| Task | Metric | Result |
| --- | --- | ---: |
| Classification | Accuracy | 0.692 |
| Classification | Balanced accuracy | 0.686 |
| Classification | Macro-F1 | 0.671 |
| Classification | Macro mAP | 0.817 |
| Segmentation | Mean Dice | 0.629 |
| Segmentation | Mean IoU | 0.548 |

At the selected checkpoint, validation macro-F1 was 0.817 and mean Dice was 0.634. The lower test macro-F1 (0.671) shows a validation/test gap on this small split. These exploratory results are not evidence of clinical utility. Use expert masks as dataset annotations for the demo; label this checkpoint's output as an experimental baseline prediction. Do not present the paper's metrics as this project's results.

Reproduce with:

```bash
python scripts/train_busi_baseline.py --epochs 20 --device auto
```

## SNU CUDA run on the identical split

A second 20-epoch run used the same seed, configuration, and exact manifest (SHA-256 `2dcc63d21ddd2c94019e6cf821a64466bf43d3e6303568e758a8e4a851ff528b`) on an NVIDIA RTX 4090 with PyTorch `2.11.0+cu128`. The best checkpoint was selected at epoch 11 by validation macro-F1.

| Task | Metric | Validation | Held-out test |
| --- | --- | ---: | ---: |
| Classification | Accuracy | 0.782 | 0.667 |
| Classification | Balanced accuracy | 0.846 | 0.617 |
| Classification | Macro-F1 | 0.792 | 0.621 |
| Classification | Macro mAP | 0.910 | 0.805 |
| Segmentation | Mean Dice | 0.434 | 0.504 |
| Segmentation | Mean IoU | 0.330 | 0.398 |

The test set is the same 78 images as the MPS run. The SNU result is lower on test classification metrics and segmentation Dice, despite higher validation classification scores. This shows a substantial validation/test gap and variation between runs/environments; it does not establish that either device is generally better. Both results are single exploratory runs, not clinical evidence. A prior SNU run used a regenerated manifest with 77 test images and is not directly comparable, so it is intentionally excluded here.
