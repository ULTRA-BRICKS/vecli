/**
 * @file Path command encoding/decoding for Float64Array WASM interop
 *
 * Accessed via: Internal module — encodes path data for WASM transfer and SVG import/export
 *
 * Encoding: each command = [type discriminant, ...coordinates]
 * - Move:  [0, x, y]           (3 values)
 * - Line:  [1, x, y]           (3 values)
 * - Cubic: [2, cx1, cy1, cx2, cy2, x, y] (7 values)
 * - Quad:  [3, cx, cy, x, y]   (5 values)
 * - Arc:   [4, rx, ry, rot, largeArc, sweep, x, y] (8 values)
 * - Close: [5]                  (1 value)
 */

export enum PathCmd {
  Move = 0,
  Line = 1,
  Cubic = 2,
  Quad = 3,
  Arc = 4,
  Close = 5,
}

/** Command sizes (including the type discriminant) */
const CMD_SIZE: Record<PathCmd, number> = {
  [PathCmd.Move]: 3,
  [PathCmd.Line]: 3,
  [PathCmd.Cubic]: 7,
  [PathCmd.Quad]: 5,
  [PathCmd.Arc]: 8,
  [PathCmd.Close]: 1,
};

// Decoded command types (discriminated union)
export type PathCommand =
  | { type: PathCmd.Move; x: number; y: number }
  | { type: PathCmd.Line; x: number; y: number }
  | { type: PathCmd.Cubic; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { type: PathCmd.Quad; cx: number; cy: number; x: number; y: number }
  | {
      type: PathCmd.Arc;
      rx: number;
      ry: number;
      rotation: number;
      largeArc: number;
      sweep: number;
      x: number;
      y: number;
    }
  | { type: PathCmd.Close };

export function encodeCommands(commands: PathCommand[]): Float64Array {
  let totalSize = 0;
  for (const cmd of commands) {
    totalSize += CMD_SIZE[cmd.type];
  }

  const buffer = new Float64Array(totalSize);
  let offset = 0;

  for (const cmd of commands) {
    buffer[offset++] = cmd.type;
    switch (cmd.type) {
      case PathCmd.Move:
      case PathCmd.Line:
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Cubic:
        buffer[offset++] = cmd.cx1;
        buffer[offset++] = cmd.cy1;
        buffer[offset++] = cmd.cx2;
        buffer[offset++] = cmd.cy2;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Quad:
        buffer[offset++] = cmd.cx;
        buffer[offset++] = cmd.cy;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Arc:
        buffer[offset++] = cmd.rx;
        buffer[offset++] = cmd.ry;
        buffer[offset++] = cmd.rotation;
        buffer[offset++] = cmd.largeArc;
        buffer[offset++] = cmd.sweep;
        buffer[offset++] = cmd.x;
        buffer[offset++] = cmd.y;
        break;
      case PathCmd.Close:
        break;
    }
  }

  return buffer;
}

export function decodeCommands(buffer: Float64Array): PathCommand[] {
  const commands: PathCommand[] = [];
  let offset = 0;
  const read = (): number => {
    const value=buffer[offset++];
    if(value===undefined)throw new Error('Truncated encoded path command');
    if(!Number.isFinite(value))throw new Error('Encoded path coordinates must be finite');
    return value;
  };

  while (offset < buffer.length) {
    const type = read() as PathCmd;
    switch (type) {
      case PathCmd.Move:
        commands.push({ type, x: read(), y: read() });
        break;
      case PathCmd.Line:
        commands.push({ type, x: read(), y: read() });
        break;
      case PathCmd.Cubic:
        commands.push({
          type,
          cx1: read(),
          cy1: read(),
          cx2: read(),
          cy2: read(),
          x: read(),
          y: read(),
        });
        break;
      case PathCmd.Quad:
        commands.push({
          type,
          cx: read(),
          cy: read(),
          x: read(),
          y: read(),
        });
        break;
      case PathCmd.Arc:
        commands.push({
          type,
          rx: read(),
          ry: read(),
          rotation: read(),
          largeArc: read(),
          sweep: read(),
          x: read(),
          y: read(),
        });
        break;
      case PathCmd.Close:
        commands.push({ type });
        break;
      default:
        throw new Error(`Unknown path command type: ${type}`);
    }
  }

  return commands;
}

const SVG_CMD_MAP: Record<string, PathCmd> = {
  M: PathCmd.Move,
  L: PathCmd.Line,
  C: PathCmd.Cubic,
  Q: PathCmd.Quad,
  A: PathCmd.Arc,
  Z: PathCmd.Close,
};

const REVERSE_CMD_MAP: Record<PathCmd, string> = {
  [PathCmd.Move]: 'M',
  [PathCmd.Line]: 'L',
  [PathCmd.Cubic]: 'C',
  [PathCmd.Quad]: 'Q',
  [PathCmd.Arc]: 'A',
  [PathCmd.Close]: 'Z',
};

export function commandsToSvgD(buffer: Float64Array): string {
  const commands = decodeCommands(buffer);
  const parts: string[] = [];

  for (const cmd of commands) {
    const letter = REVERSE_CMD_MAP[cmd.type];
    switch (cmd.type) {
      case PathCmd.Move:
      case PathCmd.Line:
        parts.push(`${letter} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Cubic:
        parts.push(`${letter} ${cmd.cx1} ${cmd.cy1} ${cmd.cx2} ${cmd.cy2} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Quad:
        parts.push(`${letter} ${cmd.cx} ${cmd.cy} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Arc:
        parts.push(`${letter} ${cmd.rx} ${cmd.ry} ${cmd.rotation} ${cmd.largeArc} ${cmd.sweep} ${cmd.x} ${cmd.y}`);
        break;
      case PathCmd.Close:
        parts.push(letter);
        break;
    }
  }

  return parts.join(' ');
}

/**
 * Tokenize an SVG path `d` string into an array of command letters and numeric strings.
 *
 * Handles all edge cases the naive split(/[\s,]+/) misses:
 *  - Adjacent negative numbers:  `M10-20`  → ['M', '10', '-20']
 *  - Adjacent decimal dots:      `L1.5.5`  → ['L', '1.5', '.5']
 *  - Scientific notation:        `L1e2 3`  → ['L', '1e2', '3']
 */
const TOKEN_RE = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
function nextNum(tokens: string[], index: { v: number }): number {
  const token=tokens[index.v++];
  if(token===undefined||/^[A-Za-z]$/.test(token))throw new Error('Missing SVG path coordinate');
  const number=Number(token);if(!Number.isFinite(number))throw new Error('SVG coordinates must be finite');return number;
}
function nextFlag(tokens:string[],index:{v:number}):number{
 const token=tokens[index.v];if(!token||!/[01]/.test(token[0]!))throw new Error('SVG arc flag must be 0 or 1');
 const flag=Number(token[0]);if(token.length===1)index.v++;else tokens[index.v]=token.slice(1);return flag;
}
export function svgDToCommands(d:string):Float64Array{
  if(typeof d!=='string'||d.length>1048576)throw new Error('SVG source limit exceeded');
  const tokens:string[]=[];let cursor=0;
  while(cursor<d.length){
    if(/[\s,]/.test(d[cursor]!)){cursor++;continue;}
    TOKEN_RE.lastIndex=cursor;const token=TOKEN_RE.exec(d);
    if(!token)throw new Error(`Invalid SVG path token at ${cursor}`);
    tokens.push(token[0]);cursor=TOKEN_RE.lastIndex;if(tokens.length>250000)throw new Error('SVG token budget exceeded');
  }
  const commands: PathCommand[] = [];
  const idx = { v: 0 };

  // Track current point for H/V/S/T conversion and relative command offsets
  let lastX = 0;
  let lastY = 0;
  // Track subpath start point to reset lastX/lastY on Z
  let startX = 0;
  let startY = 0;

  // Track current command letter for implicit repetition
  let currentLetter = '';

  while (idx.v < tokens.length) {
    if(commands.length>=50000)throw new Error('SVG command budget exceeded');
    const tok = tokens[idx.v]!;

    // If the current token is a letter, consume it as a new command
    if (/^[A-Za-z]$/.test(tok)) {
      currentLetter = tok;
      idx.v++;
    }
    // Otherwise it's a number — reuse currentLetter (implicit repetition)
    // M → L, m → l after first occurrence per SVG spec
    else if (currentLetter === 'M') {
      currentLetter = 'L';
    } else if (currentLetter === 'm') {
      currentLetter = 'l';
    }

    if (!currentLetter) throw new Error('SVG path needs a command before coordinates');

    const upper = currentLetter.toUpperCase();
    const isRelative = currentLetter !== upper;

    // Handle H/V (single-coordinate line commands) → convert to L
    if (upper === 'H') {
      const dx = nextNum(tokens, idx);
      const x = isRelative ? lastX + dx : dx;
      commands.push({ type: PathCmd.Line, x, y: lastY });
      lastX = x;
      continue;
    }
    if (upper === 'V') {
      const dy = nextNum(tokens, idx);
      const y = isRelative ? lastY + dy : dy;
      commands.push({ type: PathCmd.Line, x: lastX, y });
      lastY = y;
      continue;
    }
    // Handle S (smooth cubic) → convert to C with reflected control point
    if (upper === 'S') {
      const dcx2 = nextNum(tokens, idx);
      const dcy2 = nextNum(tokens, idx);
      const dx = nextNum(tokens, idx);
      const dy = nextNum(tokens, idx);
      const ox = isRelative ? lastX : 0;
      const oy = isRelative ? lastY : 0;
      const cx2 = ox + dcx2;
      const cy2 = oy + dcy2;
      const x = ox + dx;
      const y = oy + dy;
      // Reflect last cubic control point for cx1/cy1
      const previous=commands.at(-1);
      const cx1=previous?.type===PathCmd.Cubic?2*lastX-previous.cx2:lastX;
      const cy1=previous?.type===PathCmd.Cubic?2*lastY-previous.cy2:lastY;
      commands.push({ type: PathCmd.Cubic, cx1, cy1, cx2, cy2, x, y });
      lastX = x;
      lastY = y;
      continue;
    }
    // Handle T (smooth quad) → convert to Q with reflected control point
    if (upper === 'T') {
      const dx = nextNum(tokens, idx);
      const dy = nextNum(tokens, idx);
      const x = isRelative ? lastX + dx : dx;
      const y = isRelative ? lastY + dy : dy;
      const previous=commands.at(-1);
      const cx=previous?.type===PathCmd.Quad?2*lastX-previous.cx:lastX;
      const cy=previous?.type===PathCmd.Quad?2*lastY-previous.cy:lastY;
      commands.push({ type: PathCmd.Quad, cx, cy, x, y });
      lastX = x;
      lastY = y;
      continue;
    }

    const type = SVG_CMD_MAP[upper];
    if (type === undefined) {
      throw new Error('Unknown SVG path command');
    }

    switch (type) {
      case PathCmd.Move:
      case PathCmd.Line: {
        const dx = nextNum(tokens, idx);
        const dy = nextNum(tokens, idx);
        const x = isRelative ? lastX + dx : dx;
        const y = isRelative ? lastY + dy : dy;
        commands.push({ type, x, y });
        if (type === PathCmd.Move) {
          startX = x;
          startY = y;
        }
        lastX = x;
        lastY = y;
        break;
      }
      case PathCmd.Cubic: {
        const dcx1 = nextNum(tokens, idx);
        const dcy1 = nextNum(tokens, idx);
        const dcx2 = nextNum(tokens, idx);
        const dcy2 = nextNum(tokens, idx);
        const dx = nextNum(tokens, idx);
        const dy = nextNum(tokens, idx);
        const ox = isRelative ? lastX : 0;
        const oy = isRelative ? lastY : 0;
        const cx1 = ox + dcx1;
        const cy1 = oy + dcy1;
        const cx2 = ox + dcx2;
        const cy2 = oy + dcy2;
        const x = ox + dx;
        const y = oy + dy;
        commands.push({ type, cx1, cy1, cx2, cy2, x, y });
        lastX = x;
        lastY = y;
        break;
      }
      case PathCmd.Quad: {
        const dcx = nextNum(tokens, idx);
        const dcy = nextNum(tokens, idx);
        const dx = nextNum(tokens, idx);
        const dy = nextNum(tokens, idx);
        const ox = isRelative ? lastX : 0;
        const oy = isRelative ? lastY : 0;
        const cx = ox + dcx;
        const cy = oy + dcy;
        const x = ox + dx;
        const y = oy + dy;
        commands.push({ type, cx, cy, x, y });
        lastX = x;
        lastY = y;
        break;
      }
      case PathCmd.Arc: {
        const rx = nextNum(tokens, idx);
        const ry = nextNum(tokens, idx);
        const rotation = nextNum(tokens, idx);
        const largeArc = nextFlag(tokens, idx);
        const sweep = nextFlag(tokens, idx);
        const dx = nextNum(tokens, idx);
        const dy = nextNum(tokens, idx);
        // Only the endpoint is offset for relative arcs; rx/ry/rotation/flags are absolute
        const x = isRelative ? lastX + dx : dx;
        const y = isRelative ? lastY + dy : dy;
        commands.push({ type, rx, ry, rotation, largeArc, sweep, x, y });
        lastX = x;
        lastY = y;
        break;
      }
      case PathCmd.Close:
        commands.push({ type });
        // Reset current point to subpath start per SVG spec
        lastX = startX;
        lastY = startY;
        currentLetter = '';
        break;
    }
  }

  return encodeCommands(commands);
}
