import { Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type DictationTarget = "rich" | "raw";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  item(index: number): SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    item(index: number): SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function DictationPanel({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("Preparing microphone");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const interimTranscriptRef = useRef("");

  const commitInterimTranscript = useCallback(() => {
    const value = interimTranscriptRef.current.trim();
    if (!value) return;
    onInsert(value);
    setFinalTranscript((current) => `${current}${value} `);
    interimTranscriptRef.current = "";
    setInterimTranscript("");
  }, [onInsert]);

  const stopDictation = useCallback(() => {
    commitInterimTranscript();
    setEnabled(false);
  }, [commitInterimTranscript]);

  const closeDictation = useCallback(() => {
    commitInterimTranscript();
    onClose();
  }, [commitInterimTranscript, onClose]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((items) => setDevices(items.filter((item) => item.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("Stopped");
      setLevel(0);
      setInterimTranscript("");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setStatus("Unavailable");
      setError("Speech recognition is not available in this app webview on this Mac.");
      setEnabled(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Unavailable");
      setError("Microphone access is not available in this app webview.");
      setEnabled(false);
      return;
    }

    let cancelled = false;
    let restartTimer = 0;
    let animationFrame = 0;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    const recognition = new Recognition();

    async function start() {
      try {
        setStatus("Requesting microphone");
        setError(null);
        const audio: MediaTrackConstraints | boolean = selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : true;
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const inputs = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = inputs.filter((item) => item.kind === "audioinput");
        setDevices(audioInputs);

        const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextConstructor) {
          audioContext = new AudioContextConstructor();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            if (cancelled) return;
            analyser.getByteFrequencyData(samples);
            const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);
            setLevel(Math.min(1, average / 128));
            animationFrame = window.requestAnimationFrame(updateLevel);
          };
          updateLevel();
        }

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";
        recognition.onstart = () => {
          if (!cancelled) setStatus("Listening");
        };
        recognition.onresult = (event) => {
          if (cancelled) return;
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results.item(index);
            const transcript = result.item(0).transcript;
            if (result.isFinal) {
              interimTranscriptRef.current = "";
              setInterimTranscript("");
              setFinalTranscript((current) => `${current}${transcript.trim()} `);
              onInsert(transcript);
            } else {
              interim += transcript;
            }
          }
          const normalizedInterim = interim.trim();
          interimTranscriptRef.current = normalizedInterim;
          setInterimTranscript(normalizedInterim);
        };
        recognition.onerror = (event) => {
          if (cancelled) return;
          const message = dictationErrorMessage(event);
          setError(message);
          setStatus("Needs attention");
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setEnabled(false);
          }
        };
        recognition.onend = () => {
          if (cancelled) return;
          commitInterimTranscript();
          restartTimer = window.setTimeout(() => {
            try {
              recognition.start();
            } catch {
              setStatus("Stopped");
            }
          }, 250);
        };
        recognition.start();
      } catch (caught) {
        if (cancelled) return;
        setStatus("Unavailable");
        setError(caught instanceof Error ? caught.message : String(caught));
        setEnabled(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(restartTimer);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          // Ignore cleanup errors from engines that were never fully started.
        }
      }
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      setLevel(0);
    };
  }, [commitInterimTranscript, enabled, onInsert, selectedDeviceId]);

  const insertedCount = finalTranscript.trim() ? finalTranscript.trim().split(/\s+/).length : 0;

  return (
    <div className="dictation-popover" role="dialog" aria-modal="false" aria-labelledby="dictation-title">
      <div className="dictation-header">
        <span className={enabled ? "dictation-icon is-recording" : "dictation-icon"}>
          <Mic size={17} />
        </span>
        <div>
          <h2 id="dictation-title">Dictation</h2>
          <p>{status}{insertedCount ? ` - ${insertedCount} words inserted` : ""}</p>
        </div>
        <button className="icon-button" type="button" title="Close dictation" onClick={closeDictation}>
          <X size={17} />
        </button>
      </div>
      <label className="field-label" htmlFor="dictation-source">
        Microphone
      </label>
      <select
        id="dictation-source"
        className="dialog-input dictation-select"
        value={selectedDeviceId}
        onChange={(event) => {
          setSelectedDeviceId(event.target.value);
          setEnabled(true);
        }}
        disabled={!devices.length}
      >
        <option value="">System default</option>
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
      <div className="dictation-meter" aria-hidden="true">
        <span style={{ width: `${Math.max(6, Math.round(level * 100))}%` }} />
      </div>
      <p className="dictation-live-text" aria-live="polite">
        {interimTranscript ? `Hearing: ${interimTranscript}` : "Recognized text is inserted directly into the note."}
      </p>
      {error ? <p className="dialog-error">{error}</p> : null}
      <div className="dialog-actions">
        {enabled ? (
          <button className="secondary-button" type="button" onClick={stopDictation}>
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => setEnabled(true)}>
            <Mic size={14} />
            Start
          </button>
        )}
      </div>
    </div>
  );
}

function getSpeechRecognitionConstructor() {
  const target = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

function dictationErrorMessage(event: SpeechRecognitionErrorEventLike) {
  if (event.message) return event.message;
  switch (event.error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech recognition permission was denied.";
    case "audio-capture":
      return "No microphone input is available.";
    case "network":
      return "Speech recognition could not connect.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return event.error ? `Speech recognition stopped: ${event.error}.` : "Speech recognition stopped.";
  }
}

export function formatDictationInsertion(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return `${normalized} `;
}
