/**
 * Minimal evaluator for the spreadsheet formulas used in the Lead Contact Report:
 * COUNTA, COUNT, COUNTBLANK, COUNTIF, COUNTIFS, SUM, SUMIF, cell references, + - * / and & (concatenation).
 *
 * Used (1) when building the export, to confirm each formula reproduces the backend's value before it is written,
 * and (2) in tests, to recalculate exported workbooks and the reference workbook independently of Excel.
 * Semantics follow Excel: text criteria are case-insensitive, "" matches empty cells, "<x"/">=x" compare numbers
 * (dates are serial numbers), COUNT counts numbers, COUNTA counts non-empty cells.
 */
export type Scalar = number | string | boolean | null;

export interface Grid {
  /** Value of a cell; row/col are 1-based. Dates must be given as Excel serial numbers. */
  get(sheet: string, row: number, col: number): Scalar;
}

type Value = Scalar | { range: Scalar[] };

const colNum = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel serial number for a naive (UTC-encoded) timestamp. */
export const toSerial = (ms: number) => ms / 86400000 + 25569;

class Parser {
  private i = 0;
  constructor(
    private readonly src: string,
    private readonly grid: Grid,
    private readonly sheet: string,
  ) {}

  parse(): Scalar {
    const v = this.concat();
    this.ws();
    if (this.i < this.src.length) throw new Error(`Unexpected "${this.src.slice(this.i)}"`);
    return scalar(v);
  }

  private ws() {
    while (this.src[this.i] === ' ') this.i++;
  }
  private peek(s: string) {
    this.ws();
    return this.src.startsWith(s, this.i);
  }
  private eat(s: string) {
    if (!this.peek(s)) throw new Error(`Expected "${s}" at ${this.i} in ${this.src}`);
    this.i += s.length;
  }

  private concat(): Value {
    let v = this.add();
    while (this.peek('&')) {
      this.eat('&');
      v = `${text(scalar(v))}${text(scalar(this.add()))}`;
    }
    return v;
  }
  private add(): Value {
    let v = this.mul();
    for (;;) {
      if (this.peek('+')) {
        this.eat('+');
        v = num(scalar(v)) + num(scalar(this.mul()));
      } else if (this.peek('-')) {
        this.eat('-');
        v = num(scalar(v)) - num(scalar(this.mul()));
      } else return v;
    }
  }
  private mul(): Value {
    let v = this.factor();
    for (;;) {
      if (this.peek('*')) {
        this.eat('*');
        v = num(scalar(v)) * num(scalar(this.factor()));
      } else if (this.peek('/')) {
        this.eat('/');
        const d = num(scalar(this.factor()));
        v = d === 0 ? Number.NaN : num(scalar(v)) / d;
      } else return v;
    }
  }
  private factor(): Value {
    this.ws();
    if (this.peek('(')) {
      this.eat('(');
      const v = this.concat();
      this.eat(')');
      return v;
    }
    if (this.peek('"')) {
      this.eat('"');
      let s = '';
      while (this.i < this.src.length) {
        if (this.src[this.i] === '"' && this.src[this.i + 1] === '"') {
          s += '"';
          this.i += 2;
        } else if (this.src[this.i] === '"') break;
        else s += this.src[this.i++];
      }
      this.eat('"');
      return s;
    }
    const numM = /^\d+(\.\d+)?/.exec(this.src.slice(this.i));
    if (numM) {
      this.i += numM[0].length;
      return Number(numM[0]);
    }
    const fn = /^([A-Z]+)\(/.exec(this.src.slice(this.i));
    if (fn) {
      this.i += fn[1].length;
      this.eat('(');
      const args: Value[] = [];
      if (!this.peek(')')) {
        args.push(this.concat());
        while (this.peek(',')) {
          this.eat(',');
          args.push(this.concat());
        }
      }
      this.eat(')');
      return call(fn[1], args);
    }
    return this.ref();
  }
  private ref(): Value {
    const m = /^(?:'([^']+)'!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/.exec(this.src.slice(this.i));
    if (!m) throw new Error(`Cannot parse "${this.src.slice(this.i)}"`);
    this.i += m[0].length;
    const sheet = m[1] ?? this.sheet;
    const c1 = colNum(m[2]);
    const r1 = Number(m[3]);
    if (!m[4]) return this.grid.get(sheet, r1, c1);
    const c2 = colNum(m[4]);
    const r2 = Number(m[5]);
    const out: Scalar[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(this.grid.get(sheet, r, c));
    return { range: out };
  }
}

function scalar(v: Value): Scalar {
  return v && typeof v === 'object' ? (v.range[0] ?? null) : v;
}
function num(v: Scalar): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}
function text(v: Scalar): string {
  return v === null ? '' : String(v);
}
function range(v: Value): Scalar[] {
  if (v && typeof v === 'object') return v.range;
  return [v];
}
const isEmpty = (v: Scalar) => v === null || v === '';

/** Excel criteria matching for COUNTIF/COUNTIFS/SUMIF. */
export function matches(cell: Scalar, criteria: Scalar): boolean {
  if (typeof criteria === 'number') return typeof cell === 'number' && cell === criteria;
  const c = text(criteria);
  const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(c);
  const op = m ? m[1] : '=';
  const rhs = m ? m[2] : c;
  const rhsNum = rhs !== '' && Number.isFinite(Number(rhs)) ? Number(rhs) : null;
  if (op === '=' && rhs === '') return isEmpty(cell);
  if (op === '<>' && rhs === '') return !isEmpty(cell);
  if (rhsNum !== null) {
    if (typeof cell !== 'number') return op === '<>';
    switch (op) {
      case '<':
        return cell < rhsNum;
      case '<=':
        return cell <= rhsNum;
      case '>':
        return cell > rhsNum;
      case '>=':
        return cell >= rhsNum;
      case '<>':
        return cell !== rhsNum;
      default:
        return cell === rhsNum;
    }
  }
  const eq = typeof cell === 'string' && cell.toLowerCase() === rhs.toLowerCase();
  return op === '<>' ? !eq : op === '=' ? eq : false;
}

function call(fn: string, args: Value[]): Value {
  switch (fn) {
    case 'COUNTA':
      return args.flatMap(range).filter((v) => !isEmpty(v)).length;
    case 'COUNT':
      return args.flatMap(range).filter((v) => typeof v === 'number').length;
    case 'COUNTBLANK':
      return range(args[0]).filter(isEmpty).length;
    case 'SUM':
      return args.flatMap(range).reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    case 'COUNTIF':
      return range(args[0]).filter((v) => matches(v, scalar(args[1]))).length;
    case 'COUNTIFS': {
      const ranges = args.filter((_, i) => i % 2 === 0).map(range);
      const crit = args.filter((_, i) => i % 2 === 1).map(scalar);
      let n = 0;
      for (let k = 0; k < ranges[0].length; k++) if (ranges.every((rg, j) => matches(rg[k], crit[j]))) n++;
      return n;
    }
    case 'SUMIF': {
      const rg = range(args[0]);
      const sumRg = range(args[2] ?? args[0]);
      return rg.reduce<number>((s, v, k) => s + (matches(v, scalar(args[1])) && typeof sumRg[k] === 'number' ? (sumRg[k] as number) : 0), 0);
    }
    default:
      throw new Error(`Unsupported function ${fn}`);
  }
}

export function evaluate(formula: string, grid: Grid, sheet: string): Scalar {
  return new Parser(formula.replace(/^=/, ''), grid, sheet).parse();
}
