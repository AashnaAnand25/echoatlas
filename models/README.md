# EchoAtlas model weights

The public starter repo does not include the MaskFormer implementation or trained weights from the supplied BUSI research paper. The API reports inference as unavailable until both are provided. It will not substitute random weights or the old brain-tumor model.

Expected checkpoint path: `models/EchoAtlas_MaskFormer.pth`. To use another location, set `ECHOATLAS_MODEL_PATH`.

Add a compatible `backend.maskformer_adapter` module exposing `load_inference_model(checkpoint_path, device)` and `predict_image(image_path, model, classes, device)`. Confirm architecture, class mapping (`normal`, `benign`, `malignant`), preprocessing, and checkpoint format match before enabling it. Do not commit data or weights unless their license permits redistribution.

Until those assets are available, use expert masks as **dataset annotations**, not model predictions. See `scripts/prepare_busi.py` and `backend/busi_dataset.py` for the BUSI data pipeline.
