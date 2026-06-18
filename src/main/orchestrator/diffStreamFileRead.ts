/**

 * Windowed file reads for `DiffStreamer` when on-disk bodies exceed

 * the in-memory cap. Locates `oldString` via streaming search and

 * reads a bounded slice around the match.

 */



import { createReadStream, promises as fs } from 'node:fs';



const SEARCH_CHUNK_BYTES = 64 * 1024;



/** Default read window for oversized files (each side of the anchor). */

export const LARGE_FILE_WINDOW_BYTES = 256 * 1024;



/**

 * Stream-search a UTF-8 file for `needle` without loading the whole

 * body. Returns the byte offset of the first match, or `null`.

 */

export async function findByteOffsetInFile(

  abs: string,

  needle: string

): Promise<number | null> {

  if (needle.length === 0) return null;

  const needleBuf = Buffer.from(needle, 'utf8');



  return new Promise((resolve, reject) => {

    let processedBytes = 0;

    let carry = Buffer.alloc(0);

    const stream = createReadStream(abs, {

      highWaterMark: SEARCH_CHUNK_BYTES

    });



    const finish = (value: number | null) => {

      stream.destroy();

      resolve(value);

    };



    stream.on('data', (chunk: string | Buffer) => {

      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      const haystack = Buffer.concat([carry, buf]);

      const idx = haystack.indexOf(needleBuf);

      if (idx !== -1) {

        finish(processedBytes - carry.length + idx);

        return;

      }

      const overlap = Math.max(0, needleBuf.length - 1);

      carry = haystack.subarray(Math.max(0, haystack.length - overlap));

      processedBytes += buf.length;

    });

    stream.on('error', reject);

    stream.on('end', () => finish(null));

  });

}



export interface WindowedFileSlice {

  slice: string;

  /** 0-based line index in the full file where `slice` begins. */

  lineOffset: number;

}



async function countNewlinesBeforeByte(abs: string, endExclusive: number): Promise<number> {

  if (endExclusive <= 0) return 0;



  return new Promise((resolve, reject) => {

    let count = 0;

    const stream = createReadStream(abs, {

      start: 0,

      end: Math.max(0, endExclusive - 1),

      highWaterMark: SEARCH_CHUNK_BYTES

    });

    stream.on('data', (chunk: string | Buffer) => {

      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      for (let i = 0; i < text.length; i++) {

        if (text.charCodeAt(i) === 10) count++;

      }

    });

    stream.on('error', reject);

    stream.on('end', () => resolve(count));

  });

}



/**

 * Read a byte-bounded window around `anchorOffset`, trimming to line

 * boundaries so the LCS walk sees whole lines.

 */

export async function readFileWindow(

  abs: string,

  fileSize: number,

  anchorOffset: number,

  windowBytes = LARGE_FILE_WINDOW_BYTES

): Promise<WindowedFileSlice> {

  const half = Math.floor(windowBytes / 2);

  const start = Math.max(0, anchorOffset - half);

  const length = Math.min(fileSize - start, windowBytes);

  const buf = Buffer.alloc(length);

  const fh = await fs.open(abs, 'r');

  try {

    await fh.read(buf, 0, length, start);

  } finally {

    await fh.close();

  }



  let slice = buf.toString('utf8');

  let trimStart = 0;



  if (start > 0) {

    const anchorInSlice = Math.min(Math.max(0, anchorOffset - start), slice.length);

    const beforeAnchor = slice.slice(0, anchorInSlice);

    const lastNlBeforeAnchor = beforeAnchor.lastIndexOf('\n');

    if (lastNlBeforeAnchor !== -1) {

      trimStart = lastNlBeforeAnchor + 1;

    }

  }



  const sliceStartByte = start + trimStart;

  const lineOffset = await countNewlinesBeforeByte(abs, sliceStartByte);

  if (trimStart > 0) {

    slice = slice.slice(trimStart);

  }



  return { slice, lineOffset };

}



/**

 * Load a windowed body slice around `oldString` for large-file diff

 * streaming. Returns `null` when the anchor is not yet findable.

 */

export async function loadWindowedBodyAroundAnchor(

  abs: string,

  fileSize: number,

  oldString: string

): Promise<WindowedFileSlice | null> {

  const anchor = await findByteOffsetInFile(abs, oldString);

  if (anchor === null) return null;

  return readFileWindow(abs, fileSize, anchor);

}



/**

 * Trim streamed bash `newContent` to the same head window loaded for

 * the on-disk body so windowed LCS compares like-sized slices.

 */

export function sliceTextHeadWindow(text: string, referenceLen: number): string {

  if (text.length <= referenceLen) return text;

  let slice = text.slice(0, referenceLen);

  const lastNl = slice.lastIndexOf('\n');

  if (lastNl > 0) {

    slice = slice.slice(0, lastNl + 1);

  }

  return slice;

}


