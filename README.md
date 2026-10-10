# NeuroAccess — Code Ada 2026

**Track:** Tech for Equity · **Event:** Code Ada 2026 — Flourish

NeuroAccess is a student hackathon adaptation of an open-source brain MRI research workstation. It keeps the reference project's dark/light workspace, sample-scan gallery, MRI viewer, prediction display, Grad-CAM visualization, session history, and report export. Our planned Tech for Equity direction is to make medical-imaging research interfaces easier to navigate for people with different levels of digital literacy and accessibility needs.

> This is an educational research demo, not a medical product. It is not clinically validated and must not be used to diagnose, treat, or guide care. The benchmark numbers below are reported by the upstream project and have not been independently verified by this team.

## What is in the inherited base

- Brain MRI image classification for glioma, meningioma, pituitary, and no-tumor classes.
- A browser interface with sample images, a scan viewer, Grad-CAM overlay, prediction probabilities, session history, and report export.
- A FastAPI backend and PyTorch model code, plus the original training notebook.
- A dark/light theme and workstation-style layout.

## Our hackathon extension plan

See [TEAM_PLAN.md](TEAM_PLAN.md) for a six-hour feature plan and suggested team ownership. Candidate extensions include a plain-language interface mode, keyboard and screen-reader improvements, and a carefully bounded educational explanation panel. These are planned ideas until implemented.

## Upstream project and attribution

This repository is based on [atleekumaar/brain-tumor-mri-classifier](https://github.com/atleekumaar/brain-tumor-mri-classifier), including its original code, design, training notebook, and sample assets. The upstream repository is licensed under the MIT License; the upstream `LICENSE` file and commit history are retained here. Please consult the upstream repository for original authorship and source details.

## Upstream-reported model results

The original README reports 94.56% test accuracy, 0.94 weighted F1, and other benchmark figures on its dataset split. These are upstream-reported results, not measurements produced or validated by the Code Ada team. Dataset composition, split methodology, and external validity should be assessed before making performance claims.

## Run locally

Python dependencies are listed in `requirements.txt`. The model checkpoint is not included in this repository; see [`models/README.md`](models/README.md) for setup. With dependencies and weights available, start the API with:

```bash
uvicorn backend.main:app --reload --port 8000
```

Then open `http://127.0.0.1:8000`. The frontend can also be explored through the original public demo at [brain-tumor-mri-classifier-gamma.vercel.app](https://brain-tumor-mri-classifier-gamma.vercel.app/); that demo is operated by the upstream project and is not a NeuroAccess deployment.

## License

See the retained [MIT License](LICENSE) and the upstream attribution above.
