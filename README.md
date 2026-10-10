# EchoAtlas — Code Ada 2026

**Track:** Tech for Equity · **Event:** Code Ada 2026 — Flourish

EchoAtlas is an educational breast-ultrasound case explorer. It lets learners browse de-identified BUSI cases, compare expert dataset masks with experimental model output, and read plain-language notes about the workflow and its limits. It is a hackathon research demo, not a diagnostic or clinical decision tool.

## Current status

- The EchoAtlas interface, accessible theme, case library, sources/ethics content, and BUSI API integration are in `main`.
- A small U-Net baseline was trained from scratch for 20 epochs on the duplicate-grouped, stratified image split. This is separate from the MaskFormer in the supplied paper.
- The local machine has the prepared BUSI data and baseline checkpoint. Raw data, checkpoint, and local metric JSON are intentionally excluded from Git; a fresh clone needs the data preparation and training steps below before it can return real BUSI predictions.
- Measured exploratory results are documented in [BASELINE_RESULTS.md](BASELINE_RESULTS.md). They are not clinical evidence and do not reproduce the paper's reported 0.943 mAP.
- See [TEAM_PLAN.md](TEAM_PLAN.md) for team ownership, data caveats, and presentation plan.

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

Install the dependencies and prepare the BUSI dataset using the commands above. To train the included baseline (optional if a compatible local checkpoint is already available):

```bash
python scripts/train_busi_baseline.py --epochs 20 --device auto
```

The script chooses CUDA, Apple MPS, or CPU automatically. It saves `models/EchoAtlas_baseline.pt` and `data/busi_baseline_metrics.json`; both are local artifacts. Then start the API:

```bash
python3 -m uvicorn backend.main:app --reload --port 8010
```

Open `http://127.0.0.1:8010`. If port 8010 is already in use, the app may already be running; open that URL, or choose another port such as `8011` and use that port in the browser URL.

## AI Learning Guide and C3

The AI Learning Guide UI is available in the sidebar. Its backend proxy keeps credentials out of browser code and only sends conversation messages (and one explicitly attached image, if any) when the learner presses **Send**. Chat memory is held in the browser session and is cleared on refresh or with **Clear chat**. Use public or de-identified images only.

The proxy is a scaffold for a **C3-hosted, OpenAI Chat Completions-compatible endpoint** that serves Claude. A C3 workspace URL alone is not an inference endpoint, and C3 MIS, Agentix, or GenAI routes can have different request/auth/response formats. Do not configure this proxy until the C3 app exposes a compatible route or its API contract is adapted. The chat reports “not configured” until both server-side URL and credential are set.

Expected server environment variables:

- `ECHOATLAS_C3_CHAT_URL` — HTTPS endpoint for the compatible chat route (local HTTP is allowed for local development).
- `ECHOATLAS_C3_CHAT_TOKEN` — private server-side credential; never place this in frontend code, Git, or chat messages.
- `ECHOATLAS_C3_CHAT_MODEL` — model identifier required by that route.
- Optional: `ECHOATLAS_C3_CHAT_LABEL`, `ECHOATLAS_C3_AUTH_HEADER`, `ECHOATLAS_C3_AUTH_SCHEME`.

The current proxy sends `model`, `messages`, `temperature`, and `max_tokens` and expects `choices[0].message.content` in the response. Confirm the C3 endpoint's request and response contract before setting these values; adapt the server proxy if its contract differs. Never use a browser-side API key.

## License

See the retained [MIT License](LICENSE) and the upstream attribution above.
