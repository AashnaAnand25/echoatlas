from pathlib import Path
import csv
import json
import os
import re
import shutil
import time
import uuid
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import torch
from fastapi import FastAPI, UploadFile, File, HTTPException, Request as FastAPIRequest
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

ECHOATLAS_CHAT_SYSTEM_PROMPT = """You are EchoAtlas Learning Guide, a friendly educational tutor for breast-ultrasound concepts and public research datasets. This application is not for diagnosis or clinical decision-making. Never determine whether an image is benign, malignant, cancer, or a diagnosis; do not provide treatment recommendations. If asked to interpret a scan, explain that you can discuss general visual concepts but cannot diagnose or classify an individual image. Clearly separate BUSI dataset reference labels from experimental model outputs and never treat either as clinical truth. Explain uncertainty and limitations in plain language, ask clarifying questions when useful, and keep replies concise and supportive. EchoAtlas' exploratory seed-42 runs are small U-Net experiments, not clinical evidence and not the paper's MaskFormer: the MPS held-out test results were accuracy 0.692, balanced accuracy 0.686, macro-F1 0.671, macro-mAP 0.817, mean Dice 0.629, mean IoU 0.548; the same-split SNU RTX 4090 run was accuracy 0.667, balanced accuracy 0.617, macro-F1 0.621, macro-mAP 0.805, mean Dice 0.504, mean IoU 0.398. Both used a duplicate-grouped image-level split, not patient-level validation, and each is a single exploratory run. Do not call macro-mAP accuracy or claim clinical utility. For urgent health concerns, recommend speaking with a qualified healthcare professional."""


def _chat_configured() -> bool:
    """This proxy expects a C3-hosted, OpenAI-compatible chat route."""
    endpoint = os.environ.get("ECHOATLAS_C3_CHAT_URL", "").strip()
    token = os.environ.get("ECHOATLAS_C3_CHAT_TOKEN", "").strip()
    parsed = urlparse(endpoint)
    safe_scheme = parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"})
    return bool(endpoint and token and parsed.hostname and safe_scheme)


def _sanitize_chat_messages(messages):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 12:
        raise HTTPException(status_code=422, detail="Send between 1 and 12 recent chat messages.")
    cleaned = [{"role": "system", "content": ECHOATLAS_CHAT_SYSTEM_PROMPT}]
    total_chars = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
            raise HTTPException(status_code=422, detail="Chat messages must have user or assistant roles.")
        content = message.get("content")
        if isinstance(content, str):
            total_chars += len(content)
            cleaned.append({"role": message["role"], "content": content[:4000]})
            continue
        if not isinstance(content, list) or len(content) > 4:
            raise HTTPException(status_code=422, detail="Unsupported chat content format.")
        safe_parts = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                text = part["text"][:4000]
                total_chars += len(text)
                safe_parts.append({"type": "text", "text": text})
            elif part.get("type") == "image_url" and message["role"] == "user":
                image_url = (part.get("image_url") or {}).get("url", "")
                if not isinstance(image_url, str) or not image_url.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
                    raise HTTPException(status_code=422, detail="Only an explicitly attached JPG, PNG, or WebP image is supported.")
                if len(image_url) > 5_600_000:
                    raise HTTPException(status_code=413, detail="Image is too large. Choose an image under 4 MB.")
                safe_parts.append({"type": "image_url", "image_url": {"url": image_url}})
        cleaned.append({"role": message["role"], "content": safe_parts})
    if total_chars > 18000:
        raise HTTPException(status_code=413, detail="Chat context is too long. Clear the chat and try again.")
    return cleaned

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

@app.get("/api/assistant/status")
async def get_assistant_status():
    return {
        "configured": _chat_configured(),
        "provider": "C3",
        "model_label": os.environ.get("ECHOATLAS_C3_CHAT_LABEL", "Claude via C3"),
    }


@app.post("/api/assistant/chat")
async def assistant_chat(request: FastAPIRequest):
    """Server-side proxy; credentials and provider errors never reach frontend JS."""
    if not _chat_configured():
        raise HTTPException(
            status_code=503,
            detail="Claude through C3 is not connected yet. Configure the server-side C3 chat endpoint and credential.",
        )
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The chat request must be valid JSON.") from exc
    messages = _sanitize_chat_messages(payload.get("messages") if isinstance(payload, dict) else None)
    endpoint = os.environ["ECHOATLAS_C3_CHAT_URL"].strip()
    token = os.environ["ECHOATLAS_C3_CHAT_TOKEN"].strip()
    auth_header = os.environ.get("ECHOATLAS_C3_AUTH_HEADER", "Authorization").strip()
    auth_scheme = os.environ.get("ECHOATLAS_C3_AUTH_SCHEME", "Bearer").strip()
    request_body = json.dumps({
        "model": os.environ.get("ECHOATLAS_C3_CHAT_MODEL", "claude-via-c3"),
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 700,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    headers[auth_header] = f"{auth_scheme} {token}" if auth_scheme else token
    upstream = Request(endpoint, data=request_body, headers=headers, method="POST")
    try:
        with urlopen(upstream, timeout=45) as response:
            result = json.loads(response.read(2_000_001).decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=502, detail="C3 rejected the configured credential or access scope.") from exc
        if exc.code == 429:
            raise HTTPException(status_code=503, detail="The C3 Claude route is busy. Please try again shortly.") from exc
        raise HTTPException(status_code=502, detail=f"C3 chat request failed with HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not reach the configured C3 chat route.") from exc
    try:
        answer = result["choices"][0]["message"]["content"]
        if isinstance(answer, list):
            answer = "\n".join(part.get("text", "") for part in answer if isinstance(part, dict))
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("empty completion")
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="C3 returned an unexpected chat response format.") from exc
    return {"answer": answer.strip()[:12000], "model": os.environ.get("ECHOATLAS_C3_CHAT_LABEL", "Claude via C3")}


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
