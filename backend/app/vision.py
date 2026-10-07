"""Computer vision (CV + Edge AI tracks).

detect(): YOLO object detection on one image -> boxes + annotated JPEG (base64).
describe(): send the image to a vision LLM (Gemini) for a natural-language answer.
export_onnx(): export the YOLO model to ONNX for an "on-device / edge" story.

Needs requirements-ml.txt (ultralytics, opencv). Weights download once on
first use; run `python -m app.vision` tonight to pre-download them.
"""
import base64
import os

from . import llm

_models: dict = {}


def _yolo(name: str):
    if name not in _models:
        from ultralytics import YOLO
        _models[name] = YOLO(name)
    return _models[name]


def detect(data: bytes, model_name: str | None = None, conf: float = 0.35) -> dict:
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    result = _yolo(model_name or os.getenv("YOLO_MODEL", "yolo11n.pt"))(img, conf=conf, verbose=False)[0]
    boxes = [{
        "label": result.names[int(b.cls)],
        "confidence": round(float(b.conf), 3),
        "box": [round(float(v), 1) for v in b.xyxy[0]],
    } for b in result.boxes]
    _, jpg = cv2.imencode(".jpg", result.plot())
    counts: dict[str, int] = {}
    for b in boxes:
        counts[b["label"]] = counts.get(b["label"], 0) + 1
    return {"detections": boxes, "counts": counts,
            "annotated": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}


def describe(data: bytes, question: str, mime: str = "image/jpeg") -> str:
    """Vision-LLM Q&A over an image. Works with gemini / openrouter vision models."""
    url = f"data:{mime};base64," + base64.b64encode(data).decode()
    msg = llm.chat([{"role": "user", "content": [
        {"type": "text", "text": question},
        {"type": "image_url", "image_url": {"url": url}},
    ]}])
    return msg["content"] if isinstance(msg, dict) else msg.content


def export_onnx(model_name: str = "yolo11n.pt") -> str:
    return _yolo(model_name).export(format="onnx")


if __name__ == "__main__":  # pre-download weights
    for m in ["yolo11n.pt", "yolo11n-seg.pt", "yolo11n-pose.pt"]:
        _yolo(m)
        print("ready:", m)
