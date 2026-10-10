"""Small multi-task U-Net baseline for BUSI, separate from the paper's MaskFormer."""

from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        return self.layers(value)


class BUSIMultiTaskUNet(nn.Module):
    """Educational baseline with a lesion-mask head and a 3-class head."""

    def __init__(self, num_classes: int = 3) -> None:
        super().__init__()
        self.enc1 = ConvBlock(3, 16)
        self.enc2 = ConvBlock(16, 32)
        self.enc3 = ConvBlock(32, 64)
        self.enc4 = ConvBlock(64, 128)
        self.bottleneck = ConvBlock(128, 192)
        self.pool = nn.MaxPool2d(2)
        self.dec4 = ConvBlock(192 + 128, 128)
        self.dec3 = ConvBlock(128 + 64, 64)
        self.dec2 = ConvBlock(64 + 32, 32)
        self.dec1 = ConvBlock(32 + 16, 16)
        self.mask_head = nn.Conv2d(16, 1, kernel_size=1)
        self.class_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(192, num_classes)
        )

    @staticmethod
    def _up(value: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        return F.interpolate(value, size=skip.shape[-2:], mode="bilinear", align_corners=False)

    def forward(self, image: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        e1 = self.enc1(image)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))
        center = self.bottleneck(self.pool(e4))

        d4 = self.dec4(torch.cat((self._up(center, e4), e4), dim=1))
        d3 = self.dec3(torch.cat((self._up(d4, e3), e3), dim=1))
        d2 = self.dec2(torch.cat((self._up(d3, e2), e2), dim=1))
        d1 = self.dec1(torch.cat((self._up(d2, e1), e1), dim=1))
        return self.mask_head(d1), self.class_head(center)


def load_inference_model(checkpoint_path: str, device: torch.device):
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    model = BUSIMultiTaskUNet(num_classes=len(checkpoint["classes"]))
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device).eval()
    model.image_size = int(checkpoint["image_size"])
    model.checkpoint_classes = list(checkpoint["classes"])
    return model


def predict_image(image_path: str, model, classes: list[str], device: torch.device) -> dict:
    import base64
    import io
    import time

    import numpy as np
    from PIL import Image

    started = time.perf_counter()
    with Image.open(image_path) as source:
        original_size = source.size
        grayscale = source.convert("L").resize(
            (model.image_size, model.image_size), Image.Resampling.BILINEAR
        )
        array = np.array(grayscale, dtype=np.float32, copy=True) / 255.0
    image = torch.from_numpy(array).unsqueeze(0).unsqueeze(0).repeat(1, 3, 1, 1).to(device)
    with torch.inference_mode():
        mask_logits, class_logits = model(image)
        probabilities = torch.softmax(class_logits, dim=1)[0].cpu().tolist()
        mask = torch.sigmoid(mask_logits)[0, 0].cpu().numpy()
    binary_mask = (mask >= 0.5).astype(np.uint8) * 255
    mask_image = Image.fromarray(binary_mask).resize(original_size, Image.Resampling.NEAREST)
    buffer = io.BytesIO()
    mask_image.save(buffer, format="PNG")
    return {
        "mode": "trained-baseline",
        "model_name": "BUSI multi-task U-Net baseline",
        "prediction": classes[int(np.argmax(probabilities))],
        "probabilities": dict(zip(classes, probabilities)),
        "segmentation_mask": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
        "inference_time_ms": round((time.perf_counter() - started) * 1000, 2),
    }
