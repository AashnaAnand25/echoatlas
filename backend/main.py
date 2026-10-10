from pathlib import Path
import csv
import json
import os
import re
import shutil
import time
import uuid
from urllib.parse import quote
from urllib.request import Request, urlopen
import torch
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Support running directly or as module
try:
    from model import load_model
except ImportError:
    from backend.model import load_model

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = Path(os.environ.get(
    "ECHOATLAS_MODEL_PATH", BASE_DIR / "models" / "EchoAtlas_baseline.pt"
)).expanduser().resolve()
FRONTEND_DIR = BASE_DIR / "frontend"
DATASET_DIR = BASE_DIR / "data" / "Dataset_BUSI_with_GT"
MANIFEST_PATH = BASE_DIR / "data" / "busi_manifest.csv"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="EchoAtlas - Breast Ultrasound Research API")

ATLAS_README_URL = "https://raw.githubusercontent.com/NKI-MedTech-AI/breast-ultrasound-openhub/main/README.md"
ATLAS_CACHE_SECONDS = 6 * 60 * 60
_atlas_cache = {"expires_at": 0, "payload": None}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if torch.cuda.is_available():
    device = torch.device("cuda")
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = torch.device("mps")
else:
    device = torch.device("cpu")
model, classes, model_load_error = load_model(str(MODEL_PATH), device)
if model is None:
    print(f"[WARNING] EchoAtlas inference unavailable: {model_load_error}")
else:
    print(f"[INFO] EchoAtlas trained baseline ready on {device} with classes: {classes}")

@app.get("/api/status")
async def get_status():
    metrics = None
    metrics_path = BASE_DIR / "data" / "busi_baseline_metrics.json"
    if model is not None and metrics_path.is_file():
        try:
            report = json.loads(metrics_path.read_text(encoding="utf-8"))
            test_metrics = report.get("test", {})
            metrics = {
                "test_accuracy": test_metrics.get("classification_accuracy"),
                "test_balanced_accuracy": test_metrics.get("classification_balanced_accuracy"),
                "test_macro_f1": test_metrics.get("classification_macro_f1"),
                "test_macro_mAP": test_metrics.get("classification_macro_mAP"),
                "test_mean_dice": test_metrics.get("segmentation_mean_dice"),
                "test_mean_iou": test_metrics.get("segmentation_mean_iou"),
            }
            metrics = {name: value for name, value in metrics.items() if value is not None}
        except (OSError, ValueError, TypeError):
            metrics = None
    return {
        "status": "online",
        "device": str(device),
        "mode": "trained-baseline" if model is not None else "unavailable",
        "model_loaded": model is not None,
        "model_name": "EchoAtlas BUSI baseline",
        "architecture": "Multi-task U-Net baseline (separate from paper's MaskFormer)",
        "dataset": "BUSI",
        "input_size": f"{getattr(model, 'image_size', 512)} x {getattr(model, 'image_size', 512)} grayscale",
        "classes": classes,
        "load_error": model_load_error,
        "metrics": metrics,
    }


@app.get("/api/cases")
async def get_cases():
    """Return two real, labeled examples per BUSI class when data is prepared."""
    if not MANIFEST_PATH.is_file() or not DATASET_DIR.is_dir():
        raise HTTPException(status_code=404, detail="BUSI dataset is not prepared on this server.")

    selected = []
    per_class = {name: 0 for name in ("normal", "benign", "malignant")}
    with MANIFEST_PATH.open(newline="", encoding="utf-8") as manifest:
        for row in csv.DictReader(manifest):
            label = row["label"]
            if label not in per_class or per_class[label] >= 2:
                continue
            per_class[label] += 1
            image_path = row["image"]
            mask_path = next((p for p in row.get("mask_paths", "").split(";") if p), None)
            case_number = per_class[label]
            selected.append({
                "id": f"BUSI-{label.upper()}-{case_number:02d}",
                "title": f"{label.title()} example {case_number}",
                "image": f"/api/busi/{quote(image_path, safe='/')}",
                "annotation_mask": f"/api/busi/{quote(mask_path, safe='/')}" if mask_path else None,
                "reference_label": label,
                "reference_note": "Reference class from the BUSI dataset; not a diagnosis.",
                "description": "Explore the scan and dataset annotation as educational material.",
                "filename": Path(image_path).name,
                "source": "BUSI",
            })
            if all(count >= 2 for count in per_class.values()):
                break
    return {"cases": selected}


def _plain_markdown_cell(value: str) -> str:
    """Reduce a Markdown table cell to display text without executing markup."""
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def _markdown_cell_url(value: str) -> str | None:
    markdown_url = re.search(r"\]\((https?://[^)]+)\)", value)
    if markdown_url:
        return markdown_url.group(1).strip()
    plain_url = re.search(r"https?://\S+", value)
    return plain_url.group(0).rstrip(".,") if plain_url else None


def _parse_atlas_readme(markdown: str) -> list[dict]:
    """Extract breast-ultrasound catalog metadata; never downloads image files."""
    datasets = []
    for line in markdown.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        # OpenHub table columns: row, license, country, acronym, name, access,
        # organ, modality, machine, patients, sample count, format, dimension,
        # labels, paper, primary data link, alternate link, citation number.
        if len(cells) < 18 or not cells[0].strip().isdigit():
            continue
        country = _plain_markdown_cell(cells[2])
        acronym = _plain_markdown_cell(cells[3])
        name = _plain_markdown_cell(cells[4])
        access = _plain_markdown_cell(cells[5])
        modality = _plain_markdown_cell(cells[7])
        sample_text = _plain_markdown_cell(cells[10])
        # Raw ultrasonic signal records are not image collections for this atlas.
        if not country or not acronym or not name or "raw" in modality.lower():
            continue
        count_match = re.search(r"\d[\d,]*", sample_text)
        if not count_match:
            continue
        samples = int(count_match.group(0).replace(",", ""))
        href = _markdown_cell_url(cells[15]) or _markdown_cell_url(cells[16]) or _markdown_cell_url(cells[14])
        if not href:
            continue
        license_name = _plain_markdown_cell(cells[1])
        datasets.append({
            "country": country,
            "location": "Cairo" if acronym == "BUSI" and country == "Egypt" else "",
            "name": acronym,
            "title": name,
            "images": samples,
            "sample_unit": "images/videos" if re.search(r"images?\s*/\s*videos?", sample_text, re.IGNORECASE) else "images",
            "access": f"{license_name} · {access}" if license_name and license_name.lower() != "unknown" else access,
            "href": href,
            "source": "OpenHub GitHub catalog",
            "loaded": acronym == "BUSI",
        })
    return datasets


@app.get("/api/dataset-atlas")
def get_dataset_atlas():
    """Fetch and cache public dataset metadata from the OpenHub GitHub README."""
    now = time.time()
    if _atlas_cache["payload"] and now < _atlas_cache["expires_at"]:
        return _atlas_cache["payload"]
    try:
        request = Request(ATLAS_README_URL, headers={"User-Agent": "EchoAtlas-Educational-Demo/1.0"})
        with urlopen(request, timeout=5) as response:
            markdown = response.read(1_000_000).decode("utf-8", errors="replace")
        datasets = _parse_atlas_readme(markdown)
        if not datasets:
            raise ValueError("No dataset rows were found in the public catalog.")
        payload = {
            "source": "OpenHub GitHub README",
            "source_url": ATLAS_README_URL,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "datasets": datasets,
        }
        _atlas_cache.update({"expires_at": now + ATLAS_CACHE_SECONDS, "payload": payload})
        return payload
    except (OSError, UnicodeError, ValueError, TimeoutError):
        if _atlas_cache["payload"]:
            return {**_atlas_cache["payload"], "stale": True}
        raise HTTPException(status_code=503, detail="Public dataset catalog is temporarily unavailable.")

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "EchoAtlas model is unavailable. Train the BUSI baseline or add a compatible "
                "model checkpoint; no random or simulated inference is returned."
            ),
        )
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    temp_path = UPLOAD_DIR / f"{uuid.uuid4()}.{ext}"

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        from backend.baseline import predict_image
        result = predict_image(str(temp_path), model, classes, device)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"BUSI prediction adapter is unavailable: {exc}",
        ) from exc
    finally:
        if temp_path.exists():
            os.remove(temp_path)

    return result

if FRONTEND_DIR.exists():
    if DATASET_DIR.is_dir():
        app.mount("/api/busi", StaticFiles(directory=str(DATASET_DIR)), name="busi-data")
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
