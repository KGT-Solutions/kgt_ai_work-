import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../lib/api';
import { colors, radius } from '../lib/theme';

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Finance image uploader — drag/drop + browse panel (required by default).
 */
export default function ImageUploadField({
  title = 'Upload image',
  required = true,
  file,
  setFile,
  existingUrl,
  error: externalError,
  /** 'default' | 'compact' — compact for society QR */
  size = 'default'
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const compact = size === 'compact';

  useEffect(() => {
    if (!file) {
      setPreviewUrl(existingUrl ? mediaUrl(existingUrl) : null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, existingUrl]);

  const acceptFile = (next) => {
    if (!next) return;
    if (!next.type || !next.type.startsWith('image/')) {
      setLocalError('Only image files are allowed (jpg, jpeg, png, webp).');
      return;
    }
    if (next.size > MAX_BYTES) {
      setLocalError('Image must be 5 MB or smaller.');
      return;
    }
    setLocalError('');
    setFile(next);
  };

  const onBrowse = (e) => {
    acceptFile(e.target.files?.[0] || null);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] || null);
  };

  const showError = localError || externalError;
  const hasCommitted = !!(file || existingUrl);

  return (
    <div style={{ ...styles.wrap, ...(compact ? styles.wrapCompact : styles.wrapDefault) }}>
      <div style={styles.card}>
        <div style={{ ...styles.header, ...(compact ? styles.headerCompact : {}) }}>
          <h4 style={{ ...styles.title, ...(compact ? styles.titleCompact : {}) }}>
            {title}
            {required ? <span style={styles.req}> *</span> : null}
          </h4>
        </div>

        <div
          style={{
            ...styles.dropzone,
            ...(compact ? styles.dropzoneCompact : {}),
            ...(dragging ? styles.dropzoneActive : {}),
            ...(showError ? styles.dropzoneError : {})
          }}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={onBrowse}
            style={{ display: 'none' }}
          />

          {previewUrl ? (
            <div style={styles.previewBlock} onClick={(e) => e.stopPropagation()}>
              <img
                src={previewUrl}
                alt=""
                style={{ ...styles.previewImg, ...(compact ? styles.previewImgCompact : {}) }}
              />
              <p style={styles.fileName}>
                {file?.name || 'Current image on file'}
              </p>
              <button
                type="button"
                style={styles.changeLink}
                onClick={() => inputRef.current?.click()}
              >
                Replace image
              </button>
            </div>
          ) : (
            <>
              <UploadIcon size={compact ? 28 : 36} />
              <p style={{ ...styles.dropText, ...(compact ? styles.dropTextCompact : {}) }}>
                Drag and Drop or{' '}
                <span style={styles.browse}>Browse</span>
                {' '}to Upload
              </p>
              <p style={styles.formats}>Supported formats: jpg, jpeg, png, webp</p>
            </>
          )}
        </div>

        {showError ? (
          <p style={{ ...styles.error, ...(compact ? styles.errorCompact : {}) }}>{showError}</p>
        ) : null}
      </div>
      {required && !hasCommitted ? (
        <p style={styles.requiredHint}>An image is required before you can save.</p>
      ) : null}
    </div>
  );
}

function UploadIcon({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M20 26V12M20 12l-5 5M20 12l5 5"
        stroke={colors.accent}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 26v2.5A3.5 3.5 0 0 0 13.5 32h13a3.5 3.5 0 0 0 3.5-3.5V26"
        stroke={colors.accent}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const styles = {
  wrap: { marginTop: 4 },
  wrapDefault: { maxWidth: 420 },
  wrapCompact: { maxWidth: 280 },
  card: {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: 0,
    overflow: 'hidden'
  },
  header: {
    padding: '12px 14px',
    borderBottom: `1px solid ${colors.border}`
  },
  headerCompact: {
    padding: '10px 12px'
  },
  title: {
    margin: 0,
    fontSize: 15,
    fontWeight: 700,
    color: colors.text
  },
  titleCompact: {
    fontSize: 13
  },
  req: { color: colors.error },
  dropzone: {
    margin: 14,
    border: `1.5px dashed ${colors.border}`,
    borderRadius: radius.sm,
    minHeight: 140,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
    cursor: 'pointer',
    background: '#FAFBFA',
    transition: 'border-color 0.15s, background 0.15s'
  },
  dropzoneCompact: {
    margin: 10,
    minHeight: 110,
    padding: 12,
    gap: 4
  },
  dropzoneActive: {
    borderColor: colors.accent,
    background: colors.accentSoft
  },
  dropzoneError: {
    borderColor: '#E8A59A',
    background: '#FDF6F5'
  },
  dropText: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: colors.text,
    textAlign: 'center'
  },
  dropTextCompact: {
    fontSize: 12
  },
  browse: {
    color: colors.accent,
    fontWeight: 700
  },
  formats: {
    margin: 0,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center'
  },
  previewBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    width: '100%'
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: 120,
    borderRadius: radius.sm,
    objectFit: 'contain',
    border: `1px solid ${colors.border}`,
    background: '#fff'
  },
  previewImgCompact: {
    maxHeight: 88
  },
  fileName: {
    margin: 0,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: 600,
    textAlign: 'center',
    wordBreak: 'break-all'
  },
  changeLink: {
    background: 'none',
    border: 'none',
    color: colors.accent,
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
    padding: 0
  },
  error: {
    margin: '0 14px 12px',
    fontSize: 12,
    color: colors.error,
    fontWeight: 600
  },
  errorCompact: {
    margin: '0 10px 10px',
    fontSize: 11
  },
  requiredHint: {
    margin: '8px 0 0',
    fontSize: 12,
    color: colors.error,
    fontWeight: 600
  }
};
