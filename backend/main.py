from pathlib import Path
import os
import shutil
import uuid
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
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="EchoAtlas - Breast Ultrasound Research API")

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
    }

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
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
