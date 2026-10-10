# Code Ada plan: EchoAtlas

**Track:** Tech for Equity  
**Product:** EchoAtlas — an accessible breast-ultrasound case-learning workstation.

## The user problem

Learners in programs with fewer imaging resources can have limited access to annotated ultrasound cases and tools that explain how to inspect them. Dense, inaccessible research interfaces make that harder. EchoAtlas is an educational case explorer for medical learners; it is not a patient-facing diagnostic tool or a clinical decision system.

## The demo solution

Reuse the existing workstation layout, but make the content about breast ultrasound. A learner can open a de-identified public case, compare the original scan with its expert annotation and an experimental model overlay, view the dataset label and model output separately, and read a plain-language explanation of the workflow. Include keyboard access, readable contrast, and a compact low-bandwidth interface.

**Suggested name and visual direction:** EchoAtlas; deep navy with teal and warm coral accents. Keep the existing workstation feel while replacing brain-MRI and clinical-diagnosis language with ultrasound-learning language.

## Dataset and task

Recommended starting point: [BrEaST / Breast-Lesions-USG on TCIA](https://www.cancerimagingarchive.net/collection/breast-lesions-usg/). It provides 256 patient cases, 522 ultrasound images, expert lesion annotations, and clinical labels; the dataset is available under CC BY 4.0. See the [dataset paper](https://doi.org/10.1038/s41597-024-02984-z) for citation and details. Keep the images out of the GitHub repo unless the team deliberately chooses to distribute them with the required attribution; document the download and citation instead.

- **Segmentation:** predict the lesion mask; report Dice and IoU on held-out cases.
- **Classification:** benign vs. malignant for cases with a usable reference label; report AUROC, balanced accuracy, and macro-F1.
- Split by patient/case ID so images from the same case cannot appear in both training and test sets. Keep any augmentation in the training split only.
- Use the team's existing breast-lesion checkpoint only if its input format and label definitions match. Otherwise treat it as a baseline and fine-tune/evaluate on this dataset. Do not promise that a previous 94.3% result will transfer.
- If BrEaST download or preprocessing blocks the team, use BUSI as a fallback for the demo. BUSI has 780 ultrasound images with labels and masks, but it lacks reliable public patient IDs and duplicate leakage has been reported; group exact/near duplicates before splitting and describe the result as image-level exploratory evaluation, not patient-level validation.

## Six-hour plan

| Time | Shared milestone |
| --- | --- |
| 0:00–0:30 | Run the existing UI; confirm that no model checkpoint is present and that standalone predictions are simulated. Agree on EchoAtlas, the learner user story, the dataset, and the API response shape. |
| 0:30–1:15 | Download/inspect the dataset, confirm image-mask-label pairing, and build one representative case card. In parallel, apply the theme and map the tabs. |
| 1:15–3:30 | Build the segmentation/classification baseline and metrics; independently adapt the UI. If training is blocked, use a real checkpoint or display ground-truth annotations only—never show fabricated predictions as model output. |
| 3:30–4:30 | Integrate through the agreed API; connect a sample case and upload flow. Clearly label dataset annotation, model prediction, and demo-only states. |
| 4:30–5:15 | Check one full demo path, compute/report metrics from the held-out split, verify attribution, and fix the biggest failure. |
| 5:15–6:00 | Rehearse the five-minute pitch, share speaking time, and prepare screenshots as a backup. |

## Three-person ownership

| Person | Owns | Deliverable |
| --- | --- | --- |
| 1 — You: data/model pipeline | Dataset loading and audit, case-level split, model inference/training, metrics, and backend response contract. | One reproducible case result with a real predicted mask and class output, or a clearly labeled ground-truth-only fallback. |
| 2 — Visual design | `frontend/style.css`: EchoAtlas color system, accessible contrast, focus states, text sizing, and responsive/low-bandwidth presentation. Coordinate with Person 3 on the brand words; avoid editing their HTML/JS files. | A cohesive accessible workstation theme. |
| 3 — Product/UI | `frontend/index.html` and `frontend/script.js`: rebrand text, repurpose tabs, case flow, model/data labels, and API integration. Coordinate API fields with Person 1; avoid editing CSS. | A clear learner journey from case selection to annotation/model comparison. |

## Suggested tabs

1. **Overview** — what EchoAtlas teaches and the non-diagnostic boundary.
2. **Case Library** — public example cases and their dataset labels.
3. **Ultrasound Workspace** — image controls plus distinct toggles for expert annotation and model mask.
4. **Classification** — benign/malignant model output, probabilities, and uncertainty.
5. **Explainability** — what the mask shows, what it cannot establish, and key terms.
6. **History / Reports** — local demo session history, labeled as educational output.
7. **Sources & Ethics** — dataset attribution, split protocol, limitations, and disclaimer.

## Shared integration contract

Agree before implementation. Suggested response from `POST /predict`:

```json
{
  "mode": "trained",
  "prediction": "benign",
  "probabilities": {"benign": 0.72, "malignant": 0.28},
  "segmentation_mask": "data:image/png;base64,...",
  "inference_time_ms": 42
}
```

`mode` must distinguish a trained checkpoint from a mock/demo. If no checkpoint is loaded, the UI should show that state and must not display a simulated class result as a prediction. Expert masks supplied with a case should be labeled **dataset annotation**, never **model output**.

## Copy-ready prompts for teammates

### Person 1 — data and models

```text
You own the data/model pipeline for EchoAtlas, a Code Ada Tech for Equity educational breast-ultrasound case explorer. Work only in backend/model/data-related files; do not edit frontend files. First inspect the existing repo and report how its standalone fallback behaves and whether a trained checkpoint is present. Use the BrEaST / Breast-Lesions-USG TCIA dataset if available; cite its CC BY 4.0 source and do not commit raw scans. Build a loader that pairs each image with its case ID, reference label, and expert lesion mask. Split by case/patient ID before augmentation. Create a realistic baseline: lesion segmentation plus benign/malignant classification only where reference labels exist. Reuse my existing breast-lesion checkpoint only if its classes, preprocessing, and input format match; otherwise do not claim its old score applies. Report Dice/IoU for segmentation and AUROC, balanced accuracy, and macro-F1 for classification on held-out cases. Expose a stable POST /predict response with mode, prediction, probabilities, segmentation_mask, and inference_time_ms, and a status endpoint that reports whether real weights loaded. Never return synthetic predictions as trained-model results. If training or data access is blocked, return an honest status and explain the smallest workable fallback. Summarize changed files, run instructions, measured metrics, split method, and limitations.
```

### Person 2 — visual design and accessibility

```text
You own the visual theme for EchoAtlas, an educational breast-ultrasound case-learning workstation for Code Ada's Tech for Equity track. Work only in frontend/style.css; do not edit index.html or script.js. Keep the existing workstation layout but create a distinct EchoAtlas identity using deep navy, teal, and warm coral accents. Improve readable contrast, visible keyboard focus, text scaling, reduced-motion behavior, and narrow-screen usability. Preserve all existing component behavior and class names. Do not add clinical claims or change image/model logic. Coordinate the exact brand text with Person 3. At the end, list the visual/accessibility changes and any markup hooks you need from Person 3.
```

### Person 3 — tabs and learner flow

```text
You own the product UI for EchoAtlas. Work only in frontend/index.html and frontend/script.js; do not edit style.css. Reuse the existing workstation layout, rebrand the interface from brain MRI to breast-ultrasound learning, and adapt the navigation into Overview, Case Library, Ultrasound Workspace, Classification, Explainability, History/Reports, and Sources & Ethics. Keep the learner user story clear: select a public case, compare the original scan, expert dataset annotation, and model-predicted mask, then inspect the dataset label and model probabilities. Label reference annotations and model predictions separately. Connect to Person 1's agreed API contract. If mode is mock or weights are missing, show a visible demo-only state and do not present a fabricated label as a model prediction. Keep all copy educational and non-diagnostic. Do not change the model backend. At the end, list the demo flow, changed files, and the API fields you depend on.
```

## Five-minute presentation story

Introduce the team and Tech for Equity problem. Show one real case: select it, toggle the expert mask, show a model overlay only if the checkpoint actually ran, and explain the difference in plain language. Report the held-out case split and the appropriate metrics without claiming clinical readiness. Close with how accessible case libraries and future validation could support more equitable imaging education.
