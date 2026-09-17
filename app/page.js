'use client';

import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { PDFDocument, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const tabs = [
  { id: 'image-pdf', label: 'Image to PDF', icon: '▣' },
  { id: 'image-image', label: 'Image to Image', icon: '▧' },
  { id: 'pdf-image', label: 'PDF to Image', icon: '▤' },
  { id: 'document-pdf', label: 'Document to PDF', icon: '▥' },
  { id: 'csv-xlsx', label: 'CSV to XLSX', icon: '▦' },
  { id: 'video-gif', label: 'Video to GIF', icon: '◉' },
];

const formats = ['PDF', 'PNG', 'JPG', 'WEBP', 'CSV', 'XLSX'];

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function readableSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function convertImage(file, mime, quality) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image conversion failed'))), mime, quality / 100);
  });
}

async function imagesToPdf(files, quality) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const jpeg = await convertImage(file, 'image/jpeg', quality);
    const image = await pdf.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

// DOCX to PDF Conversion
async function docxToPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value || 'Empty document';

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  
  const lines = text.split('\n').slice(0, 45); 
  let y = 800;

  lines.forEach((line) => {
    if (y > 40) {
      page.drawText(line.substring(0, 90), {
        x: 40,
        y,
        size: 10,
        color: rgb(0, 0, 0),
      });
      y -= 16;
    }
  });

  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

function baseName(name) {
  return name.replace(/\.[^/.]+$/, '');
}

export default function Home() {
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('image-pdf');
  const [output, setOutput] = useState('PDF');
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Your workspace is ready.');
  const [results, setResults] = useState([]);
  const [dark, setDark] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  const onDrop = useCallback((acceptedFiles) => {
    if (!acceptedFiles.length) return;
    setFiles((current) => [...current, ...acceptedFiles]);
    setMessage(`${acceptedFiles.length} file${acceptedFiles.length > 1 ? 's' : ''} added to your workspace.`);
  }, []);

  const dropzone = useDropzone({
    onDrop,
    multiple: true,
    maxSize: 50 * 1024 * 1024,
  });

  function removeFile(index) {
    setFiles((current) => current.filter((_, i) => i !== index));
    setMessage('File removed.');
  }

  function clearWorkspace() {
    setFiles([]);
    setResults([]);
    setMessage('Workspace cleared.');
  }

  async function downloadAllZip() {
    if (!results.length) return;
    const zip = new JSZip();
    results.forEach((res) => {
      zip.file(res.name, res.blob);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, 'converted_files.zip');
  }

  async function convertFiles() {
    if (!files.length) {
      setMessage('Please add at least one file first.');
      return;
    }

    setBusy(true);
    setMessage('Preparing your conversion…');
    try {
      const converted = [];

      for (const file of files) {
        // 1. DOCX to PDF
        if (output === 'PDF' && file.name.endsWith('.docx')) {
          const pdfBlob = await docxToPdf(file);
          converted.push({ name: `${baseName(file.name)}.pdf`, blob: pdfBlob });
        } 
        // 2. Images to PDF
        else if (output === 'PDF' && file.type.startsWith('image/')) {
          converted.push({ name: `${baseName(file.name)}.pdf`, blob: await imagesToPdf([file], quality) });
        } 
        // 3. Image Formats (PNG, JPG, WEBP)
        else if (['PNG', 'JPG', 'WEBP'].includes(output) && file.type.startsWith('image/')) {
          const mime = output === 'PNG' ? 'image/png' : output === 'JPG' ? 'image/jpeg' : 'image/webp';
          converted.push({ name: `${baseName(file.name)}.${output.toLowerCase()}`, blob: await convertImage(file, mime, quality) });
        } 
        // 4. Spreadsheets (CSV / XLSX)
        else if ((output === 'CSV' || output === 'XLSX') && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx'))) {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          if (output === 'CSV') {
            converted.push({ name: `${baseName(file.name)}.csv`, blob: new Blob([XLSX.utils.sheet_to_csv(sheet)], { type: 'text/csv' }) });
          } else {
            converted.push({ name: `${baseName(file.name)}.xlsx`, blob: new Blob([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) });
          }
        } 
        // Fallback Document Preview to PDF
        else {
          const text = await file.text();
          const pdf = await PDFDocument.create();
          const page = pdf.addPage([595, 842]);
          page.drawText(text.slice(0, 2600) || 'FileForge document preview', { x: 40, y: 790, size: 10, maxWidth: 510, lineHeight: 14 });
          converted.push({ name: `${baseName(file.name)}.pdf`, blob: new Blob([await pdf.save()], { type: 'application/pdf' }) });
        }
      }

      setResults(converted);
      setMessage(converted.length ? `${converted.length} file${converted.length > 1 ? 's' : ''} ready to download.` : 'No compatible files found for this output format.');
      localStorage.setItem('fileforge-last-conversion', new Date().toISOString());
    } catch (error) {
      setMessage(`Conversion failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={dark ? 'site-shell dark-mode' : 'site-shell light-mode'}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar container">
        <a className="brand" href="#home" aria-label="File home">
          <span className="brand-mark">⬡</span>
          <span>File<span>Forge</span></span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a className="active" href="#home">Home</a>
          <a href="#converter">Convert⌄</a>
          <a href="#tools">Tools⌄</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
        </nav>
        <div className="top-actions">
          <button className="theme-toggle" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">☼ <span>◐</span></button>
          <a className="primary-btn small-btn" href="#converter">Get Started <span>↗</span></a>
        </div>
      </header>

      <section id="home" className="hero container">
        <div className="hero-copy">
          <div className="eyebrow"><span>✦</span> FAST <b>•</b> SECURE <b>•</b> FREE</div>
          <h1>Universal File Converter<br /><span>Convert Anything, Effortlessly.</span></h1>
          <p>Transform documents, images and spreadsheets in a beautiful, simple workspace. Your files stay in your browser while you work (developed by Arslan fayyaz).</p>
          <div className="hero-benefits">
            <div><span>▣</span><p><b>100+ Formats</b><small>Wide format support</small></p></div>
            <div><span>ϟ</span><p><b>Fast Conversion</b><small>In seconds</small></p></div>
            <div><span>♢</span><p><b>Secure & Private</b><small>Browser-first processing</small></p></div>
            <div><span>☁</span><p><b>No Installation</b><small>Works on any device</small></p></div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="floating-file pdf-file">PDF</div>
          <div className="floating-file jpg-file">JPG</div>
          <div className="floating-file doc-file">DOCX</div>
          <div className="floating-file xls-file">XLSX</div>
          <div className="folder-art"><span>☁</span></div>
          <div className="upload-arrow">↗</div>
        </div>
      </section>

      <section id="converter" className="converter-card container">
        <div className="tool-tabs" role="tablist" aria-label="Conversion types">
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? 'tool-tab selected' : 'tool-tab'} onClick={() => { setActiveTab(tab.id); setMessage(`${tab.label} selected.`); }} role="tab" aria-selected={activeTab === tab.id}>
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
          <button className="tool-tab more-tab" onClick={() => setShowAdvanced((value) => !value)}><span>•••</span> More Tools</button>
        </div>

        <div className="workspace-grid">
          <div className="upload-column">
            <div {...dropzone.getRootProps()} className={dropzone.isDragActive ? 'dropzone drag-active' : 'dropzone'}>
              <input {...dropzone.getInputProps()} />
              <div className="cloud-icon">☁</div>
              <h2>{dropzone.isDragActive ? 'Drop your files here' : 'Drag & drop your files here'}</h2>
              <p>or</p>
              <button className="primary-btn" type="button">▣ &nbsp; Choose Files</button>
              <small>Supports JPG, PNG, GIF, WEBP, PDF, DOCX, CSV, XLSX <b>|</b> Max size: 50MB</small>
            </div>
            {showAdvanced && <div className="advanced-panel"><b>Advanced tools</b><span>Batch ordering, OCR and video conversion are planned modules in this MVP.</span></div>}
          </div>

          <aside className="settings-panel">
            <label>Output Format<select value={output} onChange={(event) => setOutput(event.target.value)}><option value="PDF">▣ PDF</option>{formats.filter((format) => format !== 'PDF').map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
            <div className="quality-heading"><label htmlFor="quality">Quality</label><strong>{quality}%</strong></div>
            <input id="quality" className="quality-range" type="range" min="10" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
            <div className="range-labels"><span>Lower size</span><span>Better quality</span></div>
            <button className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>⚙ Advanced Options <span>⌄</span></button>
            <button className="convert-btn" onClick={convertFiles} disabled={busy}>{busy ? 'Converting…' : '✦ &nbsp; Convert Files'} <span>›</span></button>
            <p className="privacy-note">♧ Your files are processed locally whenever supported.</p>
          </aside>
        </div>
      </section>

      <section id="tools" className="status-grid container">
        <div className="mini-card"><span>↯</span><div><b>Lightning Fast</b><p>Convert files in seconds with an optimized workspace.</p></div></div>
        <div className="mini-card"><span>♙</span><div><b>100% Secure</b><p>Your files stay private in your browser.</p></div></div>
        <div className="mini-card"><span>▣</span><div><b>Works Everywhere</b><p>Use it on desktop, tablet or mobile.</p></div></div>
        <div className="mini-card"><span>♡</span><div><b>Easy to Use</b><p>A clean interface with useful controls.</p></div></div>
      </section>

      <section className="results-section container">
        <div className="section-heading"><div><span className="section-kicker">WORKSPACE</span><h2>Selected Files <em>{files.length}</em></h2></div><button className="ghost-btn" onClick={clearWorkspace}>Clear all ↗</button></div>
        <div className="file-list">
          {files.length === 0 ? <div className="empty-state"><span>＋</span><p>No files selected yet. Add files above to see them here.</p></div> : files.map((file, index) => <div className="file-row" key={`${file.name}-${index}`}><span className="file-icon">▤</span><div className="file-details"><b>{file.name}</b><small>{file.type || 'Unknown format'} · {readableSize(file.size)}</small></div><span className="file-status">Ready</span><button className="remove-btn" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>×</button></div>)}
        </div>
        <div className="section-heading downloads-heading">
          <div><span className="section-kicker">OUTPUT</span><h2>Downloads <em>{results.length}</em></h2></div>
          {results.length > 1 && <button className="primary-btn small-btn" onClick={downloadAllZip}>Download All as ZIP 📦</button>}
        </div>
        <div className="download-list">
          {results.length === 0 ? <div className="empty-state"><span>↓</span><p>Converted files will appear here, ready for download.</p></div> : results.map((result, index) => <div className="file-row" key={`${result.name}-${index}`}><span className="file-icon success">✓</span><div className="file-details"><b>{result.name}</b><small>Conversion complete</small></div><button className="primary-btn download-btn" onClick={() => downloadBlob(result.blob, result.name)}>Download ↓</button></div>)}
        </div>
        <div className="workspace-footer"><span className="status-dot" />{message}<span className="workspace-meta">{files.length} files · {readableSize(totalSize)}</span></div>
      </section>

      <section id="about" className="about-strip container"><div><span className="section-kicker">BUILT FOR EVERYONE</span><h2>Powerful tools. Simple experience.</h2></div><p>FileForge is designed as a privacy-first conversion workspace with a modern interface, clear feedback and responsive controls.</p></section>

      <footer id="contact" className="footer container"><a className="brand" href="#home"><span className="brand-mark">⬡</span><span>File<span>Forge</span></span></a><p>© 2026 FileForge. All rights reserved. Developed by Arslan fayyaz </p><div><a href="#about">Privacy</a><a href="#about">Terms</a><a href="#contact">Contact</a></div></footer>
    </main>
  );
}

