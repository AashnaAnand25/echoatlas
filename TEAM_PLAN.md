# Code Ada plan: EchoAtlas

**Track:** Tech for Equity  
**Product:** EchoAtlas — an accessible breast-ultrasound case-learning workstation.

## The user problem

Learners in programs with fewer imaging resources can have limited access to annotated ultrasound cases and tools that explain how to inspect them. Dense, inaccessible research interfaces make that harder. EchoAtlas is an educational case explorer for medical learners; it is not a patient-facing diagnostic tool or a clinical decision system.

## The demo solution

Reuse the existing workstation layout, but make the content about breast ultrasound. A learner can open a de-identified public case, compare the original scan with its expert annotation and an experimental model overlay, view the dataset label and model output separately, and read a plain-language explanation of the workflow. Include keyboard access, readable contrast, and a compact low-bandwidth interface.

**Suggested name and visual direction:** EchoAtlas; deep navy with teal and warm coral accents. Keep the existing workstation feel while replacing brain-MRI and clinical-diagnosis language with ultrasound-learning language.

## Dataset and task

Start with the team's paper topic and [BUSI (Breast Ultrasound Images)](https://scholar.cu.edu.eg/?q=afahmy/pages/dataset). The paper supplied by Aashna describes a MaskFormer workflow for BUSI with normal/benign/malignant classification and lesion masks. Keep raw scans out of GitHub; cite Al-Dhabyani et al., *Data in Brief* (2020), DOI [10.1016/j.dib.2019.104863](https://doi.org/10.1016/j.dib.2019.104863).

The paper reports 891 benign + 421 malignant + 266 normal images, while the official BUSI page reports 780 original images (437 benign, 210 malignant, 133 normal). Check the exact dataset version and counting convention before claiming reproduction. The paper's 0.943 is mAP, not plain accuracy; do not claim it as a hackathon result unless the evaluation is reproduced.

The team prepared the 780-row CC BY 4.0 mirror for this run. The pHash audit produced 124 candidate groups (277 scans) and found 8 candidate groups spanning different labels. Those are data-quality flags, not confirmed duplicates; review the generated audit JSON before training and explain any cleanup. The manifest keeps these candidate groups within one split.

- **Segmentation:** predict lesion masks; report Dice and IoU on held-out scans.
- **Classification:** three classes (normal/benign/malignant) as in the paper; report macro-F1 and balanced accuracy, and use one-vs-rest mAP only if implemented and documented.
- BUSI does not expose dependable patient identifiers. The included preparation script groups exact and near-duplicate images before a stratified image-level split. This reduces duplicate leakage but cannot establish patient-level independence; state this limitation.
- Keep `_mask` files as labels only, never as model inputs. Apply augmentation only to training data after assigning splits.
- The paper's checkpoint and MaskFormer adapter are not included in the starter repo. Use them only if the lab supplies compatible code and weights; otherwise show expert annotations as ground truth and say model inference is unavailable. Do not promise that the paper's 0.943 mAP will transfer.

## Six-hour plan

| Time | Shared milestone |
| --- | --- |
| 0:00–0:30 | Run the existing UI; inspect backend/model status, agree on EchoAtlas and the learner user story, and check whether compatible BUSI MaskFormer code and weights are available. |
| 0:30–1:15 | Download/inspect BUSI, run `python scripts/prepare_busi.py --root /path/to/Dataset_BUSI_with_GT`, confirm pairings, and build one representative case. In parallel, apply the theme and map tabs. |
| 1:15–3:30 | Build the segmentation/classification baseline and metrics; independently adapt the UI. If training is blocked, use a real checkpoint or display ground-truth annotations only—never show fabricated predictions as model output. |
| 3:30–4:30 | Integrate through the agreed API; connect a sample case and upload flow. Clearly label dataset annotation, model prediction, and demo-only states. |
| 4:30–5:15 | Check one full demo path, compute/report metrics from the held-out split, verify attribution, and fix the biggest failure. |
| 5:15–6:00 | Rehearse the five-minute pitch, share speaking time, and prepare screenshots as a backup. |

## Three-person ownership

| Person | Owns | Deliverable |
| --- | --- | --- |
| 1 — You: data/model pipeline | Dataset loading and audit, duplicate-grouped split, baseline training, metrics, and backend response contract. | One reproducible baseline prediction with its actual measured metrics, or a clearly labeled ground-truth-only fallback. |
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
  "mode": "trained-baseline",
  "prediction": "benign",
  "probabilities": {"normal": 0.08, "benign": 0.72, "malignant": 0.20},
  "segmentation_mask": "data:image/png;base64,...",
  "inference_time_ms": 42
}
```

`mode` is `trained-baseline` for the included U-Net checkpoint and `unavailable` when no model loads. If no checkpoint is loaded, the UI should show that state and must not display a simulated class result as a prediction. Expert masks supplied with a case should be labeled **dataset annotation**, never **model output**. `/api/cases` returns BUSI samples when the local dataset is prepared; otherwise the UI uses visibly illustrative placeholders.

## Copy-ready prompts for teammates

### Person 1 — data and models

```text
You own the data/model pipeline for EchoAtlas, a Code Ada Tech for Equity educational breast-ultrasound case explorer. Work only in backend/model/data-related files; do not edit frontend files. Use BUSI, matching the supplied MaskFormer paper's topic. The dataset is already prepared locally; for a fresh setup, follow README.md's parquet import and manifest commands. Review the audit, especially the 8 cross-label candidate groups. BUSI lacks reliable patient IDs, so describe the duplicate-grouped split as image-level exploratory evaluation, not patient-level validation. Run `python scripts/train_busi_baseline.py --epochs 20 --device auto` for the included small U-Net baseline; it is separate from MaskFormer. A 20-epoch MPS run produced test macro-F1 0.671 and mean Dice 0.629; see BASELINE_RESULTS.md, include the validation/test gap, and do not overstate the results. The paper reports 0.943 mAP; do not call that accuracy or claim it as reproduced without matching evaluation. Never return synthetic predictions as trained results. Summarize changed files, run instructions, measured metrics, split method, and limitations.
```

### Person 2 — visual design and accessibility

```text
You own the visual theme for EchoAtlas, an educational breast-ultrasound case-learning workstation for Code Ada's Tech for Equity track. Work only in frontend/style.css; do not edit index.html or script.js. Keep the existing workstation layout but create a distinct EchoAtlas identity using deep navy, teal, and warm coral accents. Improve readable contrast, visible keyboard focus, text scaling, reduced-motion behavior, and narrow-screen usability. Preserve all existing component behavior and class names. Do not add clinical claims or change image/model logic. Coordinate the exact brand text with Person 3. At the end, list the visual/accessibility changes and any markup hooks you need from Person 3.
```

### Person 3 — tabs and learner flow

```text
You own the product UI for EchoAtlas. Work only in frontend/index.html and frontend/script.js; do not edit style.css. Reuse the existing workstation layout, rebrand the interface from brain MRI to breast-ultrasound learning, and adapt the navigation into Overview, Case Library, Ultrasound Workspace, Classification, Explainability, History/Reports, and Sources & Ethics. Keep the learner user story clear: select a public case, compare the original scan, expert dataset annotation, and model-predicted mask, then inspect the dataset label and model probabilities. Label reference annotations and model predictions separately. Connect to Person 1's API contract: when mode is trained-baseline, visibly label it as an experimental U-Net baseline (not the paper's MaskFormer); handle HTTP 503 as no model available. Keep all copy educational and non-diagnostic. Do not change the model backend. At the end, list the demo flow, changed files, and the API fields you depend on.
```

## Five-minute presentation story

Introduce the team and Tech for Equity problem. Show one real case: select it, toggle the expert mask, show a model overlay only if the checkpoint actually ran, and explain the difference in plain language. Report the held-out case split and the appropriate metrics without claiming clinical readiness. Close with how accessible case libraries and future validation could support more equitable imaging education.
