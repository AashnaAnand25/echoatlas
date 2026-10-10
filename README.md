# EchoAtlas — Code Ada 2026

**Track:** Tech for Equity · **Event:** Code Ada 2026 — Flourish

EchoAtlas is a student hackathon adaptation of an open-source imaging workstation for educational breast-ultrasound case exploration. The planned experience compares public scans, their expert dataset annotations, and model output when a compatible trained model is available. It is for learning and research discussion, not clinical decision-making.

> This is an educational research demo, not a medical product. It is not clinically validated and must not be used to diagnose, treat, or guide care. The benchmark numbers below are reported by the upstream project and have not been independently verified by this team.

## Project status

- The inherited frontend still contains brain-MRI screens and requires the teammate's rebrand work.
- The backend no longer serves the old brain-tumor model as if it were a breast-ultrasound model.
- BUSI manifest preparation and a PyTorch dataset loader are included.
- Real MaskFormer inference remains unavailable until compatible lab code and checkpoint weights are added; `/predict` returns HTTP 503 in that state.
- See [TEAM_PLAN.md](TEAM_PLAN.md) for the team split, research caveats, and demo plan.

## Our hackathon extension plan

See [TEAM_PLAN.md](TEAM_PLAN.md) for the six-hour plan and ownership. The product goal is an accessible, plain-language learning interface with clear separation between expert annotations and model output.

## BUSI data preparation

Download BUSI from its [official dataset page](https://scholar.cu.edu.eg/?q=afahmy/pages/dataset), then prepare a manifest:

```bash
python -m pip install -r requirements.txt
python scripts/prepare_busi.py --root /path/to/Dataset_BUSI_with_GT
```

This writes `data/busi_manifest.csv` and `data/busi_manifest.audit.json`. Image paths in the manifest are relative to the dataset root. BUSI does not provide reliable patient identifiers; exact and near-duplicate scans are grouped before an image-level exploratory split, but this cannot guarantee patient-level separation. Do not add raw scans or masks to GitHub unless redistribution terms are confirmed.

The model paper supplied by the team reports 0.943 mAP, while the official dataset page describes 780 originals and the paper reports a different count. Treat those as paper-reported context, not a reproduced result; do not label mAP as accuracy. See [models/README.md](models/README.md) for the missing inference assets.

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
