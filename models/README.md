# EchoAtlas model weights

The supplied paper describes MaskFormer, but its implementation and trained weights are not in this repo. For a reproducible hackathon baseline, use `scripts/train_busi_baseline.py`; it trains a small multi-task U-Net from scratch and must be described separately from the paper's MaskFormer results.

Expected baseline checkpoint path: `models/EchoAtlas_baseline.pt`. To use another location, set `ECHOATLAS_MODEL_PATH`. The API reports inference unavailable until a checkpoint exists. It does not initialize random weights or substitute the old brain-tumor model.

Train on the prepared manifest with `python scripts/train_busi_baseline.py --epochs 20`. This selects a checkpoint by validation macro-F1 and writes held-out test metrics to `data/busi_baseline_metrics.json`. The local Apple Silicon machine can use MPS; the SNU CUDA host is also an option. Do not commit weights or raw data to GitHub.

The baseline is an exploratory educational model, not MaskFormer and not clinical evidence. Keep expert masks labeled **dataset annotations** and model output labeled **baseline prediction**. See `scripts/prepare_busi.py` and `backend/busi_dataset.py` for the BUSI data pipeline.
