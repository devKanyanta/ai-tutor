/**
 * Turns a tutor reply (markdown) into short "slides": one idea per slide.
 * Code fences, display math, lists, tables and headings stay intact; prose is
 * grouped by sentence so each slide is easy to read at a glance.
 */
const MAX_PROSE = 240;
const MIN_SLIDE = 70;

function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inMath = false;
  const flush = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) inFence = !inFence;
    if (!inFence && (line.match(/\$\$/g) || []).length % 2 === 1) inMath = !inMath;
    if (!inFence && !inMath && line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

const isStructured = (block: string) => /^(```|\$\$|#{1,3}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(block);

function splitProse(block: string): string[] {
  const flat = block.replace(/\s*\n\s*/g, ' ');
  if (flat.length <= MAX_PROSE) return [flat];
  const sentences = flat.split(/(?<=[.!?])\s+(?=["“'(\[]?[A-Z0-9])/);
  const out: string[] = [];
  let cur = '';
  for (const sentence of sentences) {
    if (cur && (cur + ' ' + sentence).length > MAX_PROSE) {
      out.push(cur);
      cur = sentence;
    } else {
      cur = cur ? `${cur} ${sentence}` : sentence;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function toSlides(markdown: string): string[] {
  const text = markdown.replace(/\r/g, '').trim();
  if (!text) return [];

  const pieces: string[] = [];
  for (const block of splitBlocks(text)) {
    if (isStructured(block)) pieces.push(block);
    else pieces.push(...splitProse(block));
  }

  // Merge fragments that are too short to stand alone with their neighbour.
  const slides: string[] = [];
  for (const piece of pieces) {
    const prev = slides[slides.length - 1];
    const small = (s: string) => s.length < MIN_SLIDE && !isStructured(s);
    if (prev && (small(prev) || (small(piece) && prev.length + piece.length < MAX_PROSE + 80)) && !prev.startsWith('```') && !piece.startsWith('```')) {
      slides[slides.length - 1] = `${prev}\n\n${piece}`;
    } else {
      slides.push(piece);
    }
  }
  return slides;
}
