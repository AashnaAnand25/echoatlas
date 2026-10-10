# EchoAtlas — Code Ada 2026

**Track:** Tech for Equity · **Event:** Code Ada 2026 — Flourish

EchoAtlas is a student hackathon adaptation of an open-source imaging workstation for educational breast-ultrasound case exploration. The planned experience compares public scans, their expert dataset annotations, and model output when a compatible trained model is available. It is for learning and research discussion, not clinical decision-making.

> This is an educational research demo, not a medical product. It is not clinically validated and must not be used to diagnose, treat, or guide care. The benchmark numbers below are reported by the upstream project and have not been independently verified by this team.

## Project status

- The inherited frontend still contains brain-MRI screens and requires the teammate's rebrand work.
- The backend no longer serves the old brain-tumor model as if it were a breast-ultrasound model.
- BUSI manifest preparation and a PyTorch dataset loader are included.
- No trained checkpoint is committed. The included baseline training script creates a small U-Net checkpoint locally; `/predict` remains unavailable on a fresh clone until it is trained or a compatible checkpoint is supplied. The paper's MaskFormer implementation is not included.
- See [TEAM_PLAN.md](TEAM_PLAN.md) for the team split, research caveats, and demo plan.

## Our hackathon extension plan

See [TEAM_PLAN.md](TEAM_PLAN.md) for the six-hour plan and ownership. The product goal is an accessible, plain-language learning interface with clear separation between expert annotations and model output.

## BUSI data preparation

The official BUSI page is the source of record. If its download is unavailable, the [MedOtter Hugging Face mirror](https://huggingface.co/datasets/MedOtter/BUSI) provides a CC BY 4.0 parquet copy and documents its known caveats. The import below preserves the source labels and writes attribution into the extracted dataset folder:

```bash
python -m pip install -r requirements.txt
mkdir -p data/raw
curl -L 'https://huggingface.co/datasets/MedOtter/BUSI/resolve/main/data/train-00000-of-00001.parquet?download=true' -o data/raw/busi-mirror-train.parquet
python scripts/import_busi_parquet.py --parquet data/raw/busi-mirror-train.parquet --output data/Dataset_BUSI_with_GT
python scripts/prepare_busi.py --root data/Dataset_BUSI_with_GT --output data/busi_manifest.csv
```

This writes `data/busi_manifest.csv` and `data/busi_manifest.audit.json`. Image paths in the manifest are relative to the dataset root. The downloaded mirror contains 780 images (437 benign, 210 malignant, 133 normal). BUSI does not provide reliable patient identifiers; exact and near-duplicate candidates are grouped before an image-level exploratory split, but this cannot guarantee patient-level separation. The current pHash audit found 124 candidate multi-image groups (277 images total) and 8 candidate groups spanning different labels; inspect the audit and source card before interpreting model scores. Do not add raw scans or masks to GitHub.

The model paper supplied by the team reports 0.943 mAP, while the official dataset page describes 780 originals and the paper reports a different count. Treat those as paper-reported context, not a reproduced result; do not label mAP as accuracy.

## Train the exploratory baseline

The repo includes a small multi-task U-Net baseline for segmentation and three-class prediction. It is distinct from the paper's MaskFormer and its reported mAP. This Mac has no CUDA device but does have Apple MPS; the script selects MPS automatically, or you can run it on an SNU CUDA machine:

```bash
python scripts/train_busi_baseline.py --epochs 20 --device auto
```

The script saves the best validation checkpoint under `models/` and writes validation/test metrics to `data/busi_baseline_metrics.json`. The 20-epoch exploratory run is documented in [BASELINE_RESULTS.md](BASELINE_RESULTS.md). Report only measured test metrics, with the split and data-quality caveats. The backend loads the baseline checkpoint automatically when present.

## Upstream project and attribution

This repository is based on [atleekumaar/brain-tumor-mri-classifier](https://github.com/atleekumaar/brain-tumor-mri-classifier), including its original code, design, training notebook, and sample assets. The upstream repository is licensed under the MIT License; the upstream `LICENSE` file and commit history are retained here. Please consult the upstream repository for original authorship and source details.

## Run locally

Python dependencies are listed in `requirements.txt`. The FastAPI status endpoint is available without the MaskFormer weights, but inference remains disabled until compatible model code and weights are supplied. Start the API with:

```bash
uvicorn backend.main:app --reload --port 8000
```

Then open `http://127.0.0.1:8000`. Until the frontend rebrand is integrated, some inherited brain-MRI interface content will remain visible.

## License

See the retained [MIT License](LICENSE) and the upstream attribution above.
