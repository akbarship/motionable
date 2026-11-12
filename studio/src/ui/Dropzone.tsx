import { useId, useState, type ReactNode } from 'react';
import { Icon, ICON } from './TopBar';

export interface FileRow {
  key: string;
  file: File;
  progress: number; // 0..1
  state: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
}

let seq = 0;
export const toRows = (files: FileList | File[]): FileRow[] =>
  Array.from(files).map((file) => ({ key: `f${++seq}`, file, progress: 0, state: 'waiting' }));

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Drop target built on a real file input inside a label: the input stays focusable,
 * so Tab reaches it and Space/Enter opens the picker.
 */
export function Dropzone({
  label,
  hint,
  accept,
  disabled,
  onFiles,
  className,
  children,
}: {
  label: string;
  hint?: string;
  accept: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      className={`drop${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        id={id}
        className="sr-only"
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      <span className="drop-icon" aria-hidden="true">
        <Icon d={ICON.upload} size={20} />
      </span>
      <span className="drop-label">{label}</span>
      {hint && <span className="drop-hint">{hint}</span>}
      {children}
    </label>
  );
}

export function FileList({ rows, onRemove, onRetry }: {
  rows: FileRow[];
  onRemove?: (key: string) => void;
  onRetry?: (key: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="files" aria-label="Fayllar">
      {rows.map((r) => (
        <li key={r.key} className={`file is-${r.state}`}>
          <div className="file-top">
            <span className="file-name" title={r.file.name}>{r.file.name}</span>
            <span className="file-meta">
              {r.state === 'done' ? 'Yuklandi' : r.state === 'uploading' ? `${Math.round(r.progress * 100)}%` : formatSize(r.file.size)}
            </span>
            {onRemove && r.state === 'waiting' && (
              <button type="button" className="icon-btn icon-btn--sm" aria-label={`${r.file.name} ni olib tashlash`} onClick={() => onRemove(r.key)}>
                <Icon d={ICON.close} size={14} />
              </button>
            )}
            {onRetry && r.state === 'error' && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRetry(r.key)}>
                Qayta urinish
              </button>
            )}
          </div>
          {(r.state === 'uploading' || r.state === 'done') && (
            <div className="bar" role="progressbar" aria-label={r.file.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)}>
              <span style={{ transform: `scaleX(${r.progress})` }} />
            </div>
          )}
          {r.error && <p className="file-error" role="alert">{r.error}</p>}
        </li>
      ))}
    </ul>
  );
}
