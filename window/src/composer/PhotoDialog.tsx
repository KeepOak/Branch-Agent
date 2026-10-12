// "Take a photo" (DESIGN-SPEC §4.3.2 Parity adds, row composer-take-photo; OpenClaw
// ui/src/pages/chat/components/chat-camera-capture.ts): a live preview, Capture, then Retake or Use photo.
// The camera starts when the dialog opens and stops when you capture or close it. The photo joins the draft.
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

type Props = { onClose: () => void; onUse: (file: File) => void; onUpload: () => void };

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was turned down. Allow it in Settings › Permissions, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found.";
  return "The camera couldn't start. Check that another app isn't using it, then try again.";
}

export function PhotoDialog({ onClose, onUse, onUpload }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    setError("");
    setWaiting(true);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
    } catch (e) {
      setError(cameraError(e));
    } finally {
      setWaiting(false);
    }
  }, []);

  // The camera runs only while there is no photo yet: on open, and again after Retake.
  useEffect(() => {
    if (photo) return;
    void start();
    return stop;
  }, [photo, start, stop]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) {
      setError("The photo couldn't be taken. Try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("The photo couldn't be taken. Try again.");
        return;
      }
      stop();
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
    }, "image/jpeg", 0.9);
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <div className="c-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="c-dlg" role="dialog" aria-modal="true" aria-label="Take a photo" onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="c-dlg-h">
          <h2>Take a photo</h2>
          <button type="button" className="c-x lg" aria-label="Close" onClick={close}><Icon name="x" /></button>
        </div>
        {photo ? <img className="c-cam" src={preview} alt="The photo you took" /> : <video ref={video} className="c-cam" muted playsInline />}
        <p className="c-pp">
          {error || (photo ? "Use this photo or take it again. Your camera is off." : waiting ? "Waiting for your camera. Allow access if asked." : "Preview your camera before taking a photo.")}
        </p>
        <div className="c-btns">
          {error ? <button type="button" className="btn ghost" onClick={() => { close(); onUpload(); }}>Upload a photo instead</button> : null}
          {photo ? (
            <>
              <button type="button" className="btn ghost" onClick={() => setPhoto(null)}>Retake</button>
              <button type="button" className="btn pri" onClick={() => { onUse(new File([photo], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })); close(); }}>Use photo</button>
            </>
          ) : (
            <button type="button" className="btn pri" disabled={Boolean(error) || waiting} onClick={capture}>Capture</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Make a picture" (+ menu): describe it, and the words go to the Trunk as "Make a picture: <words>", which it
 *  answers with its picture tool when one is set up (the preview's img-go sends the same words). */
export function PictureDialog({ onClose, onMake }: { onClose: () => void; onMake: (words: string) => void }) {
  const [words, setWords] = useState("");
  const make = () => {
    const q = words.trim();
    if (!q) return;
    onMake(q);
    onClose();
  };
  return (
    <div className="c-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="c-dlg" role="dialog" aria-modal="true" aria-label="Make a picture" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="c-dlg-h">
          <h2>Make a picture</h2>
          <button type="button" className="c-x lg" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <label className="c-fld">
          <span>Describe it</span>
          <input className="inp" autoFocus placeholder="A quiet valley at dawn, soft light" value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()} />
        </label>
        <div className="c-btns">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pri" disabled={!words.trim()} onClick={make}>Make it</button>
        </div>
      </div>
    </div>
  );
}
