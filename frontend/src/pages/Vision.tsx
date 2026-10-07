import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp } from "lucide-react";
import { postForm } from "../lib/api";
import { Button, Card, ErrorNote, inputCls } from "../components/ui";

type Detection = { label: string; confidence: number; box: number[] };

export default function Vision() {
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<{ annotated: string; counts: Record<string, number>; detections: Detection[] } | null>(null);
  const [question, setQuestion] = useState("Describe this image.");
  const [description, setDescription] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [loading, setLoading] = useState<"detect" | "describe" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!camOn) return;
    let stream: MediaStream;
    navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
      stream = s;
      if (video.current) video.current.srcObject = s;
    }).catch((e) => setError(String(e)));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [camOn]);

  function pick(f: Blob) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setDescription(null);
  }

  function snapshot() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && pick(b), "image/jpeg", 0.9);
  }

  async function call(kind: "detect" | "describe") {
    if (!file) return;
    const form = new FormData();
    form.append("file", file, "image.jpg");
    if (kind === "describe") form.append("question", question);
    setLoading(kind);
    setError(null);
    try {
      const r = await postForm(`/api/vision/${kind}`, form);
      kind === "detect" ? setResult(r) : setDescription(r.answer);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3">
        <div className="flex gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2 text-sm hover:border-brand">
            <ImageUp className="size-4" /> Upload
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          <button onClick={() => setCamOn(!camOn)} className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2 text-sm hover:border-brand">
            <Camera className="size-4" /> {camOn ? "Stop camera" : "Webcam"}
          </button>
          {camOn && <Button onClick={snapshot}>Capture</Button>}
        </div>
        {camOn && <video ref={video} autoPlay playsInline className="w-full rounded-xl" />}
        {preview && <img src={result?.annotated ?? preview} className="w-full rounded-xl" />}
        <div className="flex gap-2">
          <Button loading={loading === "detect"} disabled={!file} onClick={() => call("detect")}>Detect objects (YOLO)</Button>
        </div>
        <div className="flex gap-2">
          <input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button loading={loading === "describe"} disabled={!file} onClick={() => call("describe")}>Ask</Button>
        </div>
        <ErrorNote error={error} />
      </Card>
      <Card className="space-y-3 text-sm">
        {!result && !description && <p className="text-zinc-500">Results appear here.</p>}
        {result && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(result.counts).map(([k, v]) => (
              <span key={k} className="rounded-full bg-brand/20 px-3 py-1 text-brand">{k}: {v}</span>
            ))}
          </div>
        )}
        {description && <p className="leading-relaxed">{description}</p>}
      </Card>
    </div>
  );
}
