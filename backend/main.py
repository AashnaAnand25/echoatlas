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
from urllib.error import HTTPError, URLError
import torch
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Support running directly or as module
try:
    from model import load_model
    from atlas import get_dataset_atlas_payload
except ImportError:
    from backend.model import load_model
    from backend.atlas import get_dataset_atlas_payload

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
MODEL_PATH = Path(os.environ.get(
    "ECHOATLAS_MODEL_PATH", BASE_DIR / "models" / "EchoAtlas_baseline.pt"
)).expanduser().resolve()
FRONTEND_DIR = BASE_DIR / "frontend"
DATASET_DIR = BASE_DIR / "data" / "Dataset_BUSI_with_GT"
MANIFEST_PATH = BASE_DIR / "data" / "busi_manifest.csv"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="EchoAtlas - Breast Ultrasound Research API")

ECHOATLAS_CHAT_SYSTEM_PROMPT = """You are EchoAtlas Learning Guide, a friendly tutor for breast-ultrasound concepts and public research datasets. This is educational only, not for diagnosis or clinical decisions. Never classify or diagnose a specific scan, recommend treatment, or imply that a dataset label or experimental model output is clinical truth. If asked to interpret an individual scan, kindly say you cannot diagnose it and offer to explain general concepts instead. Answer in plain language, usually 2–4 short sentences and under 80 words. Use plain text by default: no Markdown headings, asterisks, tables, or LaTeX unless the learner asks for a structured explanation. Be warm and clear, and explain uncertainty when relevant. EchoAtlas uses small exploratory U-Net experiments, not the paper's MaskFormer. The same-split SNU test run had 66.7% accuracy, 61.7% balanced accuracy, 62.1% macro-F1, 80.5% macro-mAP, 50.4% mean Dice, and 39.8% mean IoU. This was one exploratory run on a duplicate-grouped image-level split, not patient-level validation or clinical evidence. Do not call macro-mAP accuracy or claim clinical utility. For urgent health concerns, suggest contacting a qualified healthcare professional."""


def _chat_configured() -> bool:
    """Gemini credentials stay in the server process, never in browser code."""
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def _sanitize_chat_messages(messages):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 12:
        raise HTTPException(status_code=422, detail="Send between 1 and 12 recent chat messages.")
    cleaned = []
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


@app.get("/api/dataset-atlas")
def get_dataset_atlas(refresh: bool = False):
    """Return verified public dataset metadata with cached live-source refresh."""
    return get_dataset_atlas_payload(force_refresh=refresh)

@app.get("/api/assistant/status")
async def get_assistant_status():
    return {
        "configured": _chat_configured(),
        "provider": "Google Gemini",
        "model_label": os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
    }


@app.post("/api/assistant/chat")
async def assistant_chat(request: FastAPIRequest):
    """Server-side Gemini proxy; the API key never reaches frontend JS."""
    if not _chat_configured():
        raise HTTPException(
            status_code=503,
            detail="Gemini is not connected yet. Set GEMINI_API_KEY in the server environment, then restart EchoAtlas.",
        )
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The chat request must be valid JSON.") from exc
    messages = _sanitize_chat_messages(payload.get("messages") if isinstance(payload, dict) else None)
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", model_name):
        raise HTTPException(status_code=500, detail="The configured Gemini model name is invalid.")
    contents = []
    for message in messages:
        parts = []
        content = message["content"]
        if isinstance(content, str):
            parts.append({"text": content})
        else:
            for part in content:
                if part["type"] == "text":
                    parts.append({"text": part["text"]})
                elif part["type"] == "image_url":
                    data_url = part["image_url"]["url"]
                    header, encoded = data_url.split(",", 1)
                    mime_type = header[5:].split(";", 1)[0]
                    parts.append({"inline_data": {"mime_type": mime_type, "data": encoded}})
        contents.append({"role": "model" if message["role"] == "assistant" else "user", "parts": parts})
    request_body = json.dumps({
        "system_instruction": {"parts": [{"text": ECHOATLAS_CHAT_SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 256},
    }).encode("utf-8")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model_name, safe='')}:generateContent"
    upstream = Request(endpoint, data=request_body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-goog-api-key": os.environ["GEMINI_API_KEY"].strip(),
    }, method="POST")
    try:
        with urlopen(upstream, timeout=45) as response:
            result = json.loads(response.read(2_000_001).decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=502, detail="Google rejected the Gemini API key or its access scope.") from exc
        if exc.code == 429:
            raise HTTPException(status_code=503, detail="Gemini is busy or this key reached its quota. Please try again shortly.") from exc
        raise HTTPException(status_code=502, detail=f"Gemini chat request failed with HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not reach the Gemini API.") from exc
    try:
        answer = "\n".join(
            part.get("text", "")
            for part in result["candidates"][0]["content"]["parts"]
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("empty completion")
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an unexpected or empty chat response.") from exc
    return {"answer": answer.strip()[:12000], "model": model_name}


@app.post("/api/assistant/figure")
async def assistant_figure(request: FastAPIRequest):
    """Generate a preset, abstract teaching illustration (never a patient scan)."""
    if not _chat_configured():
        raise HTTPException(status_code=503, detail="Gemini is not connected yet. Add GEMINI_API_KEY to the server environment.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The figure request must be valid JSON.") from exc
    topic = payload.get("topic") if isinstance(payload, dict) else None
    prompts = {
        "ultrasound": "Create a clean, simple educational vector infographic in a 3:2 landscape layout showing how B-mode ultrasound forms an image in three panels: a handheld probe sends sound pulses into abstract layered tissue; echoes reflect from tissue boundaries and return to the probe; echo strength becomes grayscale pixel rows in a flat 2D slice. Use simple geometric shapes, clear arrows, high contrast, and no words or letters. This is a conceptual teaching diagram, not a patient scan. Do not show a person, breast anatomy, a lesion, a tumor, cancer, or diagnosis.",
        "masks": "Create a clean educational vector infographic in a 3:2 landscape layout with three side-by-side abstract panels: a grayscale ultrasound-like texture, a separate human-drawn reference overlay, and a separate experimental model overlay. Make the overlays visibly distinct and show that they may differ. Use simple shapes and labels-free high contrast; no words or letters. Do not show a person, breast anatomy, real scan, lesion, tumor, cancer, or diagnosis.",
        "metrics": "Create a clean educational vector infographic in a 3:2 landscape layout explaining overlap between two regions: one outlined reference shape and one partly overlapping predicted shape, with their shared area highlighted. Show the idea of comparing overlap without equations or words. Use simple circles or rounded shapes, clear high contrast, and no text. This is a conceptual teaching diagram, not a clinical image or diagnostic result.",
    }
    if topic not in prompts:
        raise HTTPException(status_code=422, detail="Choose one of the available learning diagram topics.")
    model_name = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", model_name):
        raise HTTPException(status_code=500, detail="The configured Gemini image model name is invalid.")
    body = json.dumps({
        "contents": [{"parts": [{"text": prompts[topic]}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "responseFormat": {"image": {"aspectRatio": "3:2", "imageSize": "1K"}},
        },
    }).encode("utf-8")
    endpoint = f"https://generativelanguage.googleapis.com/v1/models/{quote(model_name, safe='')}:generateContent"
    upstream = Request(endpoint, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-goog-api-key": os.environ["GEMINI_API_KEY"].strip(),
    }, method="POST")
    try:
        with urlopen(upstream, timeout=90) as response:
            result = json.loads(response.read(12_000_001).decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=502, detail="Google rejected the Gemini API key or its image-generation access.") from exc
        if exc.code == 429:
            raise HTTPException(status_code=503, detail="Gemini image generation is busy or this key reached its quota.") from exc
        raise HTTPException(status_code=502, detail=f"Gemini image generation failed with HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not reach Gemini image generation.") from exc
    parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", []) if result.get("candidates") else []
    for part in parts:
        image_data = None
        if isinstance(part, dict):
            image_data = part.get("inlineData") or part.get("inline_data")
        if not isinstance(image_data, dict):
            continue
        mime_type = image_data.get("mimeType") or image_data.get("mime_type") or "image/png"
        encoded = image_data.get("data")
        if mime_type not in {"image/png", "image/jpeg", "image/webp"} or not isinstance(encoded, str) or len(encoded) > 11_000_000:
            continue
        return {"image_data_url": f"data:{mime_type};base64,{encoded}", "topic": topic}
    raise HTTPException(status_code=502, detail="Gemini did not return a usable teaching illustration.")


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
