"use client";
import { useState, useRef } from "react";

export default function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  function handleFile(file) {
    setError(null);
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext)) {
      setError("Please upload a .csv or .xlsx file.");
      return;
    }
    setFileName(file.name);
    onFile(file);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onInputChange(e) {
    const file = e.target.files[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        flex flex-col items-center justify-center w-full h-56 rounded-xl border-2 border-dashed cursor-pointer transition-all
        ${dragging
          ? "border-black bg-black/5 scale-[1.01]"
          : "border-black/15 hover:border-black/30 hover:bg-black/2"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={onInputChange}
      />
      {fileName ? (
        <>
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-black">{fileName}</p>
          <p className="text-xs text-black/40 mt-1">Click to choose a different file</p>
        </>
      ) : (
        <>
          <div className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-black/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-black">Drop your file here</p>
          <p className="text-xs text-black/40 mt-1">CSV or XLSX · or click to browse</p>
        </>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-500 font-medium">{error}</p>
      )}
    </div>
  );
}
