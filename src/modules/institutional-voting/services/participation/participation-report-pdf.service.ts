import { Injectable } from '@nestjs/common';
import { deflateSync, inflateSync } from 'zlib';
import { ParticipationReportData } from '../../dto/participation-analytics.dto';
import { escapePdfTextWinAnsi } from '../pdf/pdf-text-encoding';

type PdfPage = {
  content: string;
  image?: PdfImagePlacement;
};

type ModalScreenshot = {
  mimeType: 'image/png' | 'image/jpeg';
  buffer: Buffer;
};

type PdfImage = {
  width: number;
  height: number;
  colorSpace: '/DeviceRGB';
  filter: '/FlateDecode' | '/DCTDecode';
  data: Buffer;
  smask?: {
    width: number;
    height: number;
    data: Buffer;
  };
};

type PdfImagePlacement = {
  image: PdfImage;
  x: number;
  y: number;
  width: number;
  height: number;
};

@Injectable()
export class ParticipationReportPdfService {
  buildPdf(report: ParticipationReportData, modalScreenshot: ModalScreenshot): Buffer {
    const pages: PdfPage[] = [this.buildScreenshotPage(modalScreenshot)];
    pages.push(...this.buildTablePages(report));
    return this.buildDocument(pages);
  }

  private buildScreenshotPage(modalScreenshot: ModalScreenshot): PdfPage {
    const image = this.toPdfImage(modalScreenshot);
    const maxWidth = 515;
    const maxHeight = 762;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (595 - width) / 2;
    const y = (842 - height) / 2;

    return {
      content: `q\n${width} 0 0 ${height} ${x} ${y} cm\n/Im1 Do\nQ`,
      image: { image, x, y, width, height },
    };
  }

  private buildTablePages(report: ParticipationReportData): PdfPage[] {
    const rows = [
      ...report.participants.map((entry) => ({
        carnetNorm: entry.carnetNorm,
        participated: 'Sí',
      })),
      ...report.pending.map((entry) => ({
        carnetNorm: entry.carnetNorm,
        participated: 'No',
      })),
    ].sort((left, right) => left.carnetNorm.localeCompare(right.carnetNorm, 'es'));

    if (!rows.length) {
      return [
        {
          content: [
            this.text('Tabla de participación', 48, 780, 16, 'F2'),
            this.tableHeader(48, 740),
            this.text('Sin votantes habilitados en el padrón vigente.', 48, 710),
          ].join('\n'),
        },
      ];
    }

    const pages: PdfPage[] = [];
    const rowsPerPage = 36;
    for (let index = 0; index < rows.length; index += rowsPerPage) {
      const pageRows = rows.slice(index, index + rowsPerPage);
      const lines = [
        this.text('Tabla de participación', 48, 780, 16, 'F2'),
        this.tableHeader(48, 740),
      ];

      pageRows.forEach((row, rowIndex) => {
        const y = 710 - rowIndex * 18;
        lines.push(this.text(row.carnetNorm, 48, y));
        lines.push(this.text(row.participated, 330, y));
      });

      pages.push({ content: lines.join('\n') });
    }

    return pages;
  }

  private tableHeader(x: number, y: number) {
    return [
      this.text('Carnet', x, y, 12, 'F2'),
      this.text('Participó', 330, y, 12, 'F2'),
      this.line(x, y - 8, 520, y - 8),
    ].join('\n');
  }

  private buildDocument(pages: PdfPage[]) {
    const objects: Array<{ id: number; body: Buffer }> = [];
    let nextObjectId = 5;
    const pageRefs = pages.map((page) => {
      const pageObjectId = nextObjectId++;
      const contentObjectId = nextObjectId++;
      const imageObjectId = page.image ? nextObjectId++ : null;
      const smaskObjectId = page.image?.image.smask ? nextObjectId++ : null;
      return { page, pageObjectId, contentObjectId, imageObjectId, smaskObjectId };
    });

    objects.push({
      id: 1,
      body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'utf-8'),
    });
    objects.push({
      id: 2,
      body: Buffer.from(
        `<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs
          .map((ref) => `${ref.pageObjectId} 0 R`)
          .join(' ')}] >>`,
        'utf-8',
      ),
    });
    objects.push({
      id: 3,
      body: Buffer.from(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        'utf-8',
      ),
    });
    objects.push({
      id: 4,
      body: Buffer.from(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        'utf-8',
      ),
    });

    pageRefs.forEach((ref) => {
      const xObjectResource = ref.imageObjectId
        ? `/XObject << /Im1 ${ref.imageObjectId} 0 R >>`
        : '';
      objects.push({
        id: ref.pageObjectId,
        body: Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjectResource} >> /Contents ${ref.contentObjectId} 0 R >>`,
          'utf-8',
        ),
      });
      objects.push({
        id: ref.contentObjectId,
        body: this.streamObject(Buffer.from(ref.page.content, 'utf-8')),
      });

      if (ref.page.image && ref.imageObjectId) {
        objects.push({
          id: ref.imageObjectId,
          body: this.imageObject(ref.page.image.image, ref.smaskObjectId),
        });
      }

      if (ref.page.image?.image.smask && ref.smaskObjectId) {
        objects.push({
          id: ref.smaskObjectId,
          body: this.smaskObject(ref.page.image.image.smask),
        });
      }
    });

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'utf-8')];
    const offsets = new Map<number, number>();
    let byteOffset = chunks[0].length;

    objects
      .sort((left, right) => left.id - right.id)
      .forEach((object) => {
        offsets.set(object.id, byteOffset);
        const chunk = Buffer.concat([
          Buffer.from(`${object.id} 0 obj\n`, 'utf-8'),
          object.body,
          Buffer.from('\nendobj\n', 'utf-8'),
        ]);
        chunks.push(chunk);
        byteOffset += chunk.length;
      });

    const xrefOffset = byteOffset;
    const maxObjectId = Math.max(...objects.map((object) => object.id));
    let xref = `xref\n0 ${maxObjectId + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (let id = 1; id <= maxObjectId; id += 1) {
      xref += `${String(offsets.get(id) ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer << /Size ${maxObjectId + 1} /Root 1 0 R >>\n`;
    xref += `startxref\n${xrefOffset}\n%%EOF`;
    chunks.push(Buffer.from(xref, 'utf-8'));

    return Buffer.concat(chunks);
  }

  private streamObject(content: Buffer, extraDictionary = '') {
    return Buffer.concat([
      Buffer.from(`<< /Length ${content.length} ${extraDictionary} >>\nstream\n`, 'utf-8'),
      content,
      Buffer.from('\nendstream', 'utf-8'),
    ]);
  }

  private imageObject(image: PdfImage, smaskObjectId: number | null) {
    const smask = smaskObjectId ? `/SMask ${smaskObjectId} 0 R` : '';
    const dictionary =
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
      `/ColorSpace ${image.colorSpace} /BitsPerComponent 8 /Filter ${image.filter} ${smask}`;
    return this.streamObject(image.data, dictionary);
  }

  private smaskObject(smask: NonNullable<PdfImage['smask']>) {
    const dictionary =
      `/Type /XObject /Subtype /Image /Width ${smask.width} /Height ${smask.height} ` +
      '/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode';
    return this.streamObject(smask.data, dictionary);
  }

  private toPdfImage(modalScreenshot: ModalScreenshot): PdfImage {
    if (modalScreenshot.mimeType === 'image/jpeg') {
      const dimensions = this.readJpegDimensions(modalScreenshot.buffer);
      return {
        width: dimensions.width,
        height: dimensions.height,
        colorSpace: '/DeviceRGB',
        filter: '/DCTDecode',
        data: modalScreenshot.buffer,
      };
    }

    return this.readPng(modalScreenshot.buffer);
  }

  private readPng(buffer: Buffer): PdfImage {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buffer.subarray(0, 8).equals(signature)) {
      throw new Error('Invalid PNG signature');
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatChunks: Buffer[] = [];

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) {
        throw new Error('Invalid PNG chunk');
      }
      const data = buffer.subarray(dataStart, dataEnd);

      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') {
        break;
      }

      offset = dataEnd + 4;
    }

    if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
      throw new Error('Unsupported PNG format');
    }

    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const inflated = inflateSync(Buffer.concat(idatChunks));
    const scanlineLength = width * bytesPerPixel;
    const raw = Buffer.alloc(width * height * bytesPerPixel);
    let inputOffset = 0;
    let outputOffset = 0;
    let previousRow = Buffer.alloc(scanlineLength);

    for (let row = 0; row < height; row += 1) {
      const filter = inflated[inputOffset];
      inputOffset += 1;
      const currentRow = Buffer.from(inflated.subarray(inputOffset, inputOffset + scanlineLength));
      inputOffset += scanlineLength;
      this.unfilterPngRow(currentRow, previousRow, bytesPerPixel, filter);
      currentRow.copy(raw, outputOffset);
      outputOffset += scanlineLength;
      previousRow = currentRow;
    }

    if (colorType === 2) {
      return {
        width,
        height,
        colorSpace: '/DeviceRGB',
        filter: '/FlateDecode',
        data: deflateSync(raw),
      };
    }

    const rgb = Buffer.alloc(width * height * 3);
    const alpha = Buffer.alloc(width * height);
    for (let source = 0, rgbOffset = 0, alphaOffset = 0; source < raw.length; source += 4) {
      rgb[rgbOffset] = raw[source];
      rgb[rgbOffset + 1] = raw[source + 1];
      rgb[rgbOffset + 2] = raw[source + 2];
      rgbOffset += 3;
      alpha[alphaOffset] = raw[source + 3];
      alphaOffset += 1;
    }

    return {
      width,
      height,
      colorSpace: '/DeviceRGB',
      filter: '/FlateDecode',
      data: deflateSync(rgb),
      smask: {
        width,
        height,
        data: deflateSync(alpha),
      },
    };
  }

  private unfilterPngRow(
    row: Buffer,
    previousRow: Buffer,
    bytesPerPixel: number,
    filter: number,
  ) {
    for (let index = 0; index < row.length; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previousRow[index] ?? 0;
      const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;
      if (filter === 1) {
        row[index] = (row[index] + left) & 0xff;
      } else if (filter === 2) {
        row[index] = (row[index] + up) & 0xff;
      } else if (filter === 3) {
        row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        row[index] = (row[index] + this.paeth(left, up, upLeft)) & 0xff;
      } else if (filter !== 0) {
        throw new Error('Unsupported PNG filter');
      }
    }
  }

  private paeth(left: number, up: number, upLeft: number) {
    const estimate = left + up - upLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upLeftDistance = Math.abs(estimate - upLeft);
    if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
    if (upDistance <= upLeftDistance) return up;
    return upLeft;
  }

  private readJpegDimensions(buffer: Buffer) {
    if (!buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      throw new Error('Invalid JPEG signature');
    }

    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }
      const length = buffer.readUInt16BE(offset);
      const isStartOfFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += length;
    }

    throw new Error('JPEG dimensions not found');
  }

  private text(value: string, x: number, y: number, size = 10, font = 'F1') {
    return `BT\n/${font} ${size} Tf\n1 0 0 1 ${x} ${y} Tm (${escapePdfTextWinAnsi(value)}) Tj\nET`;
  }

  private line(x1: number, y1: number, x2: number, y2: number) {
    return `${x1} ${y1} m ${x2} ${y2} l S`;
  }
}
