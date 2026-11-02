import JSZip from 'jszip';

/**
 * Adds native Excel charts (DrawingML) to a workbook produced by ExcelJS, which cannot write charts itself.
 * Each chart references cells on the sheet (so it updates when Excel recalculates) and carries cached values
 * (so it renders immediately). Structure follows the charts in the SalesMax reference workbook.
 */
export interface ChartSeries {
  /** Cell holding the series name, e.g. "'Summary Report'!$B$22". */
  nameRef: string;
  name: string;
  catRef: string;
  categories: string[];
  valRef: string;
  values: number[];
  color: string; // hex without '#'
}

export interface ChartSpec {
  type: 'col' | 'bar' | 'pie';
  title: string;
  series: ChartSeries[];
  /** Zero-based anchor cell (top-left) and size in columns/rows. */
  anchor: { col: number; row: number; cols: number; rows: number };
  /** Slice colours for pie charts. */
  pointColors?: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const txPr = (size: number, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
}
function numCache(values: number[]): string {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
}

function seriesXml(s: ChartSeries, i: number, spec: ChartSpec): string {
  const fill = `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>`;
  const points =
    spec.type === 'pie' && spec.pointColors
      ? s.categories
          .map((_, p) => `<c:dPt><c:idx val="${p}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${spec.pointColors![p % spec.pointColors!.length]}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`)
          .join('')
      : '';
  const labels =
    spec.type === 'pie'
      ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`
      : `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
    `<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>` +
    (spec.type === 'pie' ? '' : fill) +
    (spec.type === 'pie' ? points : '<c:invertIfNegative val="0"/>') +
    labels +
    `<c:cat><c:strRef><c:f>${esc(s.catRef)}</c:f>${strCache(s.categories)}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${esc(s.valRef)}</c:f>${numCache(s.values)}</c:numRef></c:val>` +
    `</c:ser>`
  );
}

export function chartXml(spec: ChartSpec): string {
  const title = `<c:title><c:tx><c:rich><a:bodyPr rot="0"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1300" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:rPr><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
  let plot: string;
  if (spec.type === 'pie') {
    plot = `<c:pieChart><c:varyColors val="1"/>${spec.series.map((s, i) => seriesXml(s, i, spec)).join('')}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else {
    const axes = `<c:axId val="111111111"/><c:axId val="222222222"/>`;
    plot =
      `<c:barChart><c:barDir val="${spec.type}"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
      spec.series.map((s, i) => seriesXml(s, i, spec)).join('') +
      `<c:gapWidth val="80"/><c:overlap val="-10"/>${axes}</c:barChart>` +
      `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="${spec.type === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${spec.type === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>${txPr(900)}<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${spec.type === 'bar' ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E7E6E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900)}<c:crossAx val="111111111"/><c:crosses val="${spec.type === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  }
  const legend = spec.series.length > 1 || spec.type === 'pie' ? `<c:legend><c:legendPos val="${spec.type === 'pie' ? 'r' : 'b'}"/><c:overlay val="0"/>${txPr(900)}</c:legend>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>` +
    `</c:chartSpace>`
  );
}

function drawingXml(specs: ChartSpec[]): string {
  const anchors = specs
    .map(
      (s, i) =>
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${s.anchor.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${s.anchor.col + s.anchor.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.anchor.row + s.anchor.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

/** Injects charts into worksheet number `sheetIndex` (1-based, as in xl/worksheets/sheetN.xml). */
export async function addChartsToWorkbook(xlsx: Buffer, sheetIndex: number, specs: ChartSpec[]): Promise<Buffer> {
  if (!specs.length) return xlsx;
  const zip = await JSZip.loadAsync(xlsx);
  const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;
  const sheet = await zip.file(sheetPath)?.async('string');
  if (!sheet) throw new Error(`Worksheet ${sheetIndex} not found`);
  const drawingNo = Object.keys(zip.files).filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p)).length + 1;
  const chartStart = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p)).length + 1;

  specs.forEach((s, i) => zip.file(`xl/charts/chart${chartStart + i}.xml`, chartXml(s)));
  zip.file(`xl/drawings/drawing${drawingNo}.xml`, drawingXml(specs));
  zip.file(
    `xl/drawings/_rels/drawing${drawingNo}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartStart + i}.xml"/>`)
      .join('')}</Relationships>`,
  );

  // Sheet -> drawing relationship
  const relId = 'rIdLpDrawing1';
  const existingRels = await zip.file(sheetRelsPath)?.async('string');
  const rel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/>`;
  zip.file(
    sheetRelsPath,
    existingRels
      ? existingRels.replace('</Relationships>', `${rel}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`,
  );
  // <drawing> must follow pageMargins/pageSetup/headerFooter and precede legacyDrawing/tableParts/extLst.
  const drawingTag = `<drawing r:id="${relId}"/>`;
  const insertBefore = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']
    .map((t) => sheet.indexOf(t))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  let nextSheet = sheet.slice(0, insertBefore) + drawingTag + sheet.slice(insertBefore);
  if (!/xmlns:r="/.test(nextSheet.slice(0, 600))) nextSheet = nextSheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  zip.file(sheetPath, nextSheet);

  // Content types
  let ct = (await zip.file('[Content_Types].xml')!.async('string')) as string;
  const add = (part: string, type: string) => {
    if (!ct.includes(`PartName="/${part}"`)) ct = ct.replace('</Types>', `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  };
  specs.forEach((_, i) => add(`xl/charts/chart${chartStart + i}.xml`, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'));
  add(`xl/drawings/drawing${drawingNo}.xml`, 'application/vnd.openxmlformats-officedocument.drawing+xml');
  zip.file('[Content_Types].xml', ct);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
