# EchoAtlas model weights

The supplied paper describes MaskFormer, but its implementation and trained weights are not in this repo. For a reproducible hackathon baseline, use `scripts/train_busi_baseline.py`; it trains a small multi-task U-Net from scratch and must be described separately from the paper's MaskFormer results.

Expected local PyTorch checkpoint path: `models/EchoAtlas_baseline.pt`. To use another location, set `ECHOATLAS_MODEL_PATH`. The local API reports inference unavailable if neither a compatible `.pt` checkpoint nor the Vercel `.onnx` export is present. It does not initialize random weights or substitute the old brain-tumor model.

The Vercel deployment uses `models/EchoAtlas_baseline.onnx`, exported from the same trained checkpoint for CPU inference with ONNX Runtime. This derived model file is included in the public repository so the hosted demo can run real predictions; the original `.pt` checkpoint, raw BUSI images, masks, and training manifest remain local and are not committed. The export is checked against the source model before release.

Train on the prepared manifest with `python scripts/train_busi_baseline.py --epochs 20`. This selects a checkpoint by validation macro-F1 and writes held-out test metrics to `data/busi_baseline_metrics.json`. The local Apple Silicon machine can use MPS; the SNU CUDA host is also an option. Do not commit raw data to GitHub; only the derived ONNX model is committed for the requested hosted inference path.

The baseline is an exploratory educational model, not MaskFormer and not clinical evidence. Keep expert masks labeled **dataset annotations** and model output labeled **baseline prediction**. See `scripts/prepare_busi.py` and `backend/busi_dataset.py` for the BUSI data pipeline.
