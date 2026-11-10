import QRCode from 'qrcode';

const xml = (value) =>
  String(value ?? '')
    .replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
    )
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

export function carcassQrMatrix(job) {
  if (!job?.qrText || !job.slaughterNumber)
    throw new Error('Нет данных для формирования маркировки');
  return QRCode.create(job.qrText, { errorCorrectionLevel: 'M' }).modules;
}

// A self-contained vector label. No network, fonts, scripts, or external resources.
export function carcassLabelSvg(job) {
  const matrix = carcassQrMatrix(job),
    extent = matrix.size + 8;
  let modules = '';
  for (let row = 0; row < matrix.size; row++)
    for (let col = 0; col < matrix.size; col++)
      if (matrix.data[row * matrix.size + col]) modules += `M${col + 4},${row + 4}h1v1h-1z`;
  const numberLines = String(job.slaughterNumber).match(/.{1,22}/gu) || [];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="90mm" height="55mm" viewBox="0 0 900 550"><title>${xml(`Маркировка туши ${job.slaughterNumber}`)}</title><rect width="900" height="550" fill="white"/><svg x="20" y="20" width="450" height="450" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges"><rect width="${extent}" height="${extent}" fill="white"/><path d="${modules}" fill="black"/></svg><g fill="black" font-family="Arial, sans-serif"><text x="500" y="65" font-size="22">НОМЕР УБОЯ</text>${numberLines.map((line, i) => `<text x="500" y="${112 + i * 34}" font-size="30" font-weight="bold">${xml(line)}</text>`).join('')}<text x="500" y="260" font-size="19">Партия убоя</text><text x="500" y="293" font-size="26">${xml(job.slaughterBatchNumber || 'Не зарегистрирована')}</text><text x="500" y="353" font-size="19">Дата: ${xml(job.date || '')}</text><text x="30" y="510" font-size="18">МПК «АГРОЭКО-ЮГ» · Идентификатор туши</text></g></svg>`;
}

export function downloadCarcassLabel(job, svg = carcassLabelSvg(job)) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `QR-${job.slaughterNumber.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.svg`;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
